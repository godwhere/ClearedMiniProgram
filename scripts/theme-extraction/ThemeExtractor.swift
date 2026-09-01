import Foundation
import CoreGraphics
import CoreImage
import ImageIO
import Vision

private let requiredSlotCount = 10

enum ExtractionError: LocalizedError {
    case usage(String)
    case invalidConfig(String)
    case unsafeOutput(String)
    case image(String)
    case vision(String)

    var errorDescription: String? {
        switch self {
        case .usage(let message), .invalidConfig(let message), .unsafeOutput(let message),
             .image(let message), .vision(let message):
            return message
        }
    }
}

struct RootConfig: Decodable {
    let schemaVersion: Int?
    let layout: LayoutConfig?
    let themes: [ThemeConfig]
    let extraction: ExtractionSettings?
}

struct LayoutConfig: Decodable {
    let cellSize: Int?
    let padding: Int?
    let columns: Int?
    let rows: Int?
}

struct ThemeConfig: Decodable {
    let id: String
    let nameZh: String?
    let sourceSheet: String
    let scale: Double?
    let outputFilename: String?
    let extractionStrategy: String?
    let slots: [SlotConfig]
}

struct SlotConfig: Decodable {
    let index: Int
    let nameZh: String?
    let safeFilename: String?
    let candidates: [String]?
    let candidateIDs: [String]?
    let instanceIDs: [Int]?
    let componentIDs: [Int]?
    let expectedCenter: [Double]?
    let scale: Double?
    let offsetX: Double?
    let offsetY: Double?

    var explicitCandidateIDs: [String] {
        var result = candidates ?? []
        result.append(contentsOf: candidateIDs ?? [])
        result.append(contentsOf: (instanceIDs ?? []).map { "V\($0)" })
        result.append(contentsOf: (componentIDs ?? []).map { "A\($0)" })
        return Array(Set(result.map { $0.uppercased() })).sorted()
    }
}

struct ExtractionSettings: Decodable {
    let strategy: String?
    let alphaThreshold: Int?
    let maskThreshold: Int?
    let minimumComponentPixels: Int?
    let maximumAlphaCoverage: Double?
    let maximumCandidateDistance: Double?
}

struct CLIOptions {
    let configURL: URL
    let themeID: String
    let inputOverride: URL?
    let outputOverride: URL?
    let force: Bool
    let allowAssetsOutput: Bool

    static func parse(_ arguments: [String]) throws -> CLIOptions {
        var config: String?
        var theme: String?
        var input: String?
        var output: String?
        var force = false
        var allowAssetsOutput = false
        var index = 0

        func value(after flag: String) throws -> String {
            guard index + 1 < arguments.count else {
                throw ExtractionError.usage("Missing value after \(flag).")
            }
            index += 1
            return arguments[index]
        }

        while index < arguments.count {
            switch arguments[index] {
            case "--config": config = try value(after: "--config")
            case "--theme": theme = try value(after: "--theme")
            case "--input": input = try value(after: "--input")
            case "--output": output = try value(after: "--output")
            case "--force": force = true
            case "--allow-assets-output": allowAssetsOutput = true
            case "--help", "-h":
                throw ExtractionError.usage(Self.help)
            default:
                throw ExtractionError.usage("Unknown option: \(arguments[index])\n\n\(Self.help)")
            }
            index += 1
        }

        guard let config else { throw ExtractionError.usage(Self.help) }
        guard let theme else {
            throw ExtractionError.usage("--theme <id|all> is required.\n\n\(Self.help)")
        }
        if theme == "all", input != nil {
            throw ExtractionError.usage("--input can only be used with one theme.")
        }

        return CLIOptions(
            configURL: URL(fileURLWithPath: config).standardizedFileURL,
            themeID: theme,
            inputOverride: input.map { URL(fileURLWithPath: $0).standardizedFileURL },
            outputOverride: output.map { URL(fileURLWithPath: $0).standardizedFileURL },
            force: force,
            allowAssetsOutput: allowAssetsOutput
        )
    }

    static let help = """
    ThemeExtractor --config <themes.json> --theme <id|all> [options]

      --input <png>          Override sourceSheet for a single theme.
      --output <directory>   Candidate run root; each theme gets its own folder.
      --force                Reuse an existing candidate run directory.
      --allow-assets-output  Explicitly allow output below assets/skins.

    The default output is scripts/theme-extraction/runs/<timestamp>/<theme-id>.
    Formal assets are never overwritten unless both --allow-assets-output and
    an explicit --output path are supplied.
    """
}

struct RGBAImage {
    let width: Int
    let height: Int
    var pixels: [UInt8]

    init(width: Int, height: Int, pixels: [UInt8]? = nil) {
        self.width = width
        self.height = height
        self.pixels = pixels ?? Array(repeating: 0, count: width * height * 4)
    }

    init(cgImage: CGImage) throws {
        width = cgImage.width
        height = cgImage.height
        pixels = Array(repeating: 0, count: width * height * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue |
            CGImageAlphaInfo.premultipliedLast.rawValue
        let created = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let base = bytes.baseAddress,
                  let context = CGContext(
                    data: base,
                    width: width,
                    height: height,
                    bitsPerComponent: 8,
                    bytesPerRow: width * 4,
                    space: colorSpace,
                    bitmapInfo: bitmapInfo
                  ) else { return false }
            context.interpolationQuality = .none
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard created else { throw ExtractionError.image("Could not decode image pixels.") }
    }

    func makeCGImage() throws -> CGImage {
        let data = Data(pixels) as CFData
        guard let provider = CGDataProvider(data: data),
              let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGBitmapInfo.byteOrder32Big.rawValue |
                    CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else {
            throw ExtractionError.image("Could not create an output image.")
        }
        return image
    }

    static func load(from url: URL) throws -> (RGBAImage, CGImage) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, [
                kCGImageSourceShouldCache: true
              ] as CFDictionary) else {
            throw ExtractionError.image("Could not load PNG: \(url.path)")
        }
        return (try RGBAImage(cgImage: image), image)
    }

    func writePNG(to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            "public.png" as CFString,
            1,
            nil
        ) else {
            throw ExtractionError.image("Could not create PNG destination: \(url.path)")
        }
        CGImageDestinationAddImage(destination, try makeCGImage(), [
            kCGImagePropertyPNGInterlaceType: 0
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw ExtractionError.image("Could not write PNG: \(url.path)")
        }
    }
}

struct PixelBox: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int

    var maxX: Int { x + width - 1 }
    var maxY: Int { y + height - 1 }
}

enum CandidatePixels {
    case dense([UInt8])
    case sparse([Int])

    func merge(into selection: inout [UInt8]) {
        switch self {
        case .dense(let mask):
            for index in selection.indices where mask[index] > selection[index] {
                selection[index] = mask[index]
            }
        case .sparse(let indices):
            for index in indices { selection[index] = 255 }
        }
    }
}

struct Candidate {
    let id: String
    let source: String
    let sourceID: Int
    let pixelCount: Int
    let box: PixelBox
    let centroidX: Double
    let centroidY: Double
    let pixels: CandidatePixels
}

struct CandidateReport: Codable {
    let id: String
    let source: String
    let sourceID: Int
    let pixelCount: Int
    let box: PixelBox
    let centroid: [Double]
}

struct SlotReport: Codable {
    let index: Int
    let name: String
    let filename: String
    let expectedCenter: [Double]
    let mappingSource: String
    let candidateIDs: [String]
    let sourceBox: PixelBox?
    let normalizedBox: PixelBox?
    let safetyMargin: Int?
    let warnings: [String]
    let passed: Bool
}

struct SourceReport: Codable {
    let path: String
    let width: Int
    let height: Int
    let alphaCoverage: Double
}

struct OutputReport: Codable {
    let slotsDirectory: String
    let spriteSheet: String
    let contactSheet: String
    let candidateMap: String
}

struct ThemeReport: Codable {
    let schemaVersion: Int
    let generatedAt: String
    let themeID: String
    let themeName: String
    let source: SourceReport
    let strategyRequested: String
    let strategyUsed: String
    let visionError: String?
    let candidates: [CandidateReport]
    let slots: [SlotReport]
    let outputs: OutputReport
    let warnings: [String]
    let passed: Bool
}

struct EffectiveSettings {
    let cellSize: Int
    let padding: Int
    let columns: Int
    let rows: Int
    let strategy: String
    let alphaThreshold: UInt8
    let maskThreshold: UInt8
    let minimumComponentPixels: Int
    let maximumAlphaCoverage: Double
    let maximumCandidateDistance: Double
}

struct CandidateGroups {
    let groups: [Int: [Candidate]]
    let mappedSlotCount: Int
}

@available(macOS 14.0, *)
final class ThemeExtractionRunner {
    private let fileManager = FileManager.default
    private let ciContext = CIContext(options: [.cacheIntermediates: false])

    func run(
        theme: ThemeConfig,
        rootConfig: RootConfig,
        sourceURL: URL,
        outputDirectory: URL
    ) throws -> ThemeReport {
        try validate(theme: theme, rootConfig: rootConfig)
        let settings = effectiveSettings(rootConfig)
        let (source, cgImage) = try RGBAImage.load(from: sourceURL)
        let alphaCoverage = Double(source.pixels.indices.lazy
            .filter { $0 % 4 == 3 && source.pixels[$0] >= settings.alphaThreshold }.count) /
            Double(source.width * source.height)

        var warnings: [String] = []
        var visionError: String?
        var vision: [Candidate] = []
        do {
            vision = try visionCandidates(
                image: cgImage,
                width: source.width,
                height: source.height,
                threshold: settings.maskThreshold
            )
        } catch {
            visionError = error.localizedDescription
            warnings.append("Vision foreground detection failed; alpha fallback was evaluated.")
        }

        let alphaUsable = alphaCoverage > 0 && alphaCoverage <= settings.maximumAlphaCoverage
        let alpha: [Candidate]
        if alphaUsable {
            alpha = alphaCandidates(
                image: source,
                threshold: settings.alphaThreshold,
                minimumPixels: settings.minimumComponentPixels
            )
        } else {
            alpha = []
            warnings.append(String(
                format: "Alpha fallback disabled because coverage %.4f exceeds the %.4f limit.",
                alphaCoverage,
                settings.maximumAlphaCoverage
            ))
        }

        let orderedSlots = theme.slots.sorted { $0.index < $1.index }
        let alphaGroups = groupCandidates(
            alpha,
            slots: orderedSlots,
            width: source.width,
            height: source.height,
            maximumDistance: settings.maximumCandidateDistance,
            includeAllNearest: true
        )
        let visionGroups = groupCandidates(
            vision,
            slots: orderedSlots,
            width: source.width,
            height: source.height,
            maximumDistance: settings.maximumCandidateDistance,
            includeAllNearest: true
        )

        let requestedStrategy = theme.extractionStrategy ?? settings.strategy
        let automaticStrategy: String
        switch requestedStrategy.lowercased() {
        case "alpha": automaticStrategy = "alpha"
        case "vision": automaticStrategy = "vision"
        case "auto", "hybrid":
            if alphaGroups.mappedSlotCount == requiredSlotCount &&
                visionGroups.mappedSlotCount == requiredSlotCount {
                // Vision supplies subject-instance identity; the source alpha components
                // restore exact original edge pixels and any detached detail.
                automaticStrategy = "hybrid"
            } else if visionGroups.mappedSlotCount == requiredSlotCount {
                automaticStrategy = "vision"
            } else if alphaGroups.mappedSlotCount == requiredSlotCount {
                automaticStrategy = "alpha"
            } else if alphaGroups.mappedSlotCount >= visionGroups.mappedSlotCount {
                automaticStrategy = "alpha"
            } else {
                automaticStrategy = "vision"
            }
        default:
            throw ExtractionError.invalidConfig(
                "Unknown extraction strategy '\(requestedStrategy)'; use auto, hybrid, alpha, or vision."
            )
        }
        let automaticGroups: [Int: [Candidate]]
        if automaticStrategy == "hybrid" {
            automaticGroups = Dictionary(uniqueKeysWithValues: orderedSlots.map { slot in
                (slot.index, (visionGroups.groups[slot.index] ?? []) + (alphaGroups.groups[slot.index] ?? []))
            })
        } else {
            automaticGroups = automaticStrategy == "alpha" ? alphaGroups.groups : visionGroups.groups
        }
        let allCandidates = vision + alpha
        let byID = Dictionary(uniqueKeysWithValues: allCandidates.map { ($0.id.uppercased(), $0) })

        try fileManager.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
        let slotsDirectory = outputDirectory.appendingPathComponent("slots", isDirectory: true)
        try fileManager.createDirectory(at: slotsDirectory, withIntermediateDirectories: true)

        var normalizedSlots: [RGBAImage] = []
        var slotReports: [SlotReport] = []
        var overallPassed = true

        for slot in orderedSlots {
            var slotWarnings: [String] = []
            let explicitIDs = slot.explicitCandidateIDs
            let selected: [Candidate]
            let mappingSource: String
            let explicitMappingComplete: Bool
            if explicitIDs.isEmpty {
                selected = automaticGroups[slot.index] ?? []
                mappingSource = automaticStrategy
                explicitMappingComplete = true
            } else {
                selected = explicitIDs.compactMap { id in
                    guard let candidate = byID[id] else {
                        slotWarnings.append("Configured candidate \(id) was not detected.")
                        return nil
                    }
                    return candidate
                }
                mappingSource = "explicit"
                explicitMappingComplete = selected.count == explicitIDs.count
            }

            var selection = Array(repeating: UInt8(0), count: source.width * source.height)
            for candidate in selected { candidate.pixels.merge(into: &selection) }
            let extracted = apply(selection: selection, to: source)
            let sourceBox = alphaBox(
                extracted,
                threshold: settings.alphaThreshold
            )
            if selected.isEmpty { slotWarnings.append("No foreground candidate was mapped to this slot.") }
            if sourceBox == nil { slotWarnings.append("The selected candidates produced an empty image.") }

            // theme.scale is the runtime manifest scale. Applying it here would
            // shrink the sprite a second time, so normalization only honors a
            // deliberate per-slot extraction override.
            let slotScale = max(0.05, min(1.0, slot.scale ?? 1.0))
            let normalized = normalize(
                extracted,
                sourceBox: sourceBox,
                canvasSize: settings.cellSize,
                padding: settings.padding,
                scale: slotScale,
                offsetX: slot.offsetX ?? 0,
                offsetY: slot.offsetY ?? 0
            )
            let normalizedBox = alphaBox(normalized, threshold: settings.alphaThreshold)
            let safetyMargin = normalizedBox.map {
                min($0.x, $0.y, settings.cellSize - 1 - $0.maxX, settings.cellSize - 1 - $0.maxY)
            }
            if let safetyMargin, safetyMargin < settings.padding {
                slotWarnings.append(
                    "Visible alpha enters the \(settings.padding)-pixel safety area (actual \(safetyMargin))."
                )
            }

            let slotPassed = selected.isEmpty == false && explicitMappingComplete && sourceBox != nil &&
                normalizedBox != nil && (safetyMargin ?? -1) >= settings.padding
            overallPassed = overallPassed && slotPassed
            let filename = safeFilename(for: slot)
            try normalized.writePNG(to: slotsDirectory.appendingPathComponent(filename))
            normalizedSlots.append(normalized)
            slotReports.append(SlotReport(
                index: slot.index,
                name: slot.nameZh ?? "slot-\(slot.index)",
                filename: filename,
                expectedCenter: expectedCenter(for: slot),
                mappingSource: mappingSource,
                candidateIDs: selected.map(\.id).sorted(),
                sourceBox: sourceBox,
                normalizedBox: normalizedBox,
                safetyMargin: safetyMargin,
                warnings: slotWarnings,
                passed: slotPassed
            ))
        }

        let sheet = assembleSheet(
            normalizedSlots,
            cellSize: settings.cellSize,
            columns: settings.columns,
            rows: settings.rows
        )
        let outputFilename = sanitizedOutputFilename(theme.outputFilename ?? "\(theme.id)-sprite-sheet.png")
        let sheetURL = outputDirectory.appendingPathComponent(outputFilename)
        try sheet.writePNG(to: sheetURL)

        let contact = makeContactSheet(
            normalizedSlots,
            cellSize: settings.cellSize,
            columns: settings.columns,
            rows: settings.rows
        )
        let contactURL = outputDirectory.appendingPathComponent("contact-sheet-numbered.png")
        try contact.writePNG(to: contactURL)

        let candidateMap = makeCandidateMap(source: source, candidates: allCandidates)
        let candidateMapURL = outputDirectory.appendingPathComponent("candidate-map.png")
        try candidateMap.writePNG(to: candidateMapURL)

        if automaticStrategy == "alpha" && alphaGroups.mappedSlotCount < requiredSlotCount {
            warnings.append(
                "Alpha fallback mapped \(alphaGroups.mappedSlotCount)/\(requiredSlotCount) slots; configure candidates explicitly."
            )
        }
        if automaticStrategy == "vision" && visionGroups.mappedSlotCount < requiredSlotCount {
            warnings.append(
                "Vision mapped \(visionGroups.mappedSlotCount)/\(requiredSlotCount) slots; configure candidates explicitly."
            )
        }
        if allCandidates.isEmpty {
            warnings.append("No candidates were detected.")
            overallPassed = false
        }

        let candidateReports = allCandidates.sorted(by: candidateOrdering).map {
            CandidateReport(
                id: $0.id,
                source: $0.source,
                sourceID: $0.sourceID,
                pixelCount: $0.pixelCount,
                box: $0.box,
                centroid: [
                    $0.centroidX / Double(source.width),
                    $0.centroidY / Double(source.height)
                ]
            )
        }
        return ThemeReport(
            schemaVersion: 1,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            themeID: theme.id,
            themeName: theme.nameZh ?? theme.id,
            source: SourceReport(
                path: sourceURL.path,
                width: source.width,
                height: source.height,
                alphaCoverage: alphaCoverage
            ),
            strategyRequested: requestedStrategy,
            strategyUsed: automaticStrategy,
            visionError: visionError,
            candidates: candidateReports,
            slots: slotReports,
            outputs: OutputReport(
                slotsDirectory: slotsDirectory.path,
                spriteSheet: sheetURL.path,
                contactSheet: contactURL.path,
                candidateMap: candidateMapURL.path
            ),
            warnings: warnings,
            passed: overallPassed
        )
    }

    private func effectiveSettings(_ config: RootConfig) -> EffectiveSettings {
        let layout = config.layout
        let extraction = config.extraction
        return EffectiveSettings(
            cellSize: layout?.cellSize ?? 400,
            padding: layout?.padding ?? 24,
            columns: layout?.columns ?? 5,
            rows: layout?.rows ?? 2,
            strategy: extraction?.strategy ?? "auto",
            alphaThreshold: UInt8(clamping: extraction?.alphaThreshold ?? 8),
            maskThreshold: UInt8(clamping: extraction?.maskThreshold ?? 64),
            minimumComponentPixels: max(1, extraction?.minimumComponentPixels ?? 8),
            maximumAlphaCoverage: extraction?.maximumAlphaCoverage ?? 0.92,
            maximumCandidateDistance: extraction?.maximumCandidateDistance ?? 0.32
        )
    }

    private func validate(theme: ThemeConfig, rootConfig: RootConfig) throws {
        let layout = rootConfig.layout
        guard (layout?.cellSize ?? 400) == 400,
              (layout?.padding ?? 24) == 24,
              (layout?.columns ?? 5) == 5,
              (layout?.rows ?? 2) == 2 else {
            throw ExtractionError.invalidConfig(
                "Theme extraction contract is fixed at 400px cells, 24px padding, and a 5x2 sheet."
            )
        }
        guard theme.slots.count == requiredSlotCount else {
            throw ExtractionError.invalidConfig(
                "Theme \(theme.id) must contain exactly \(requiredSlotCount) slots."
            )
        }
        let indices = theme.slots.map(\.index).sorted()
        guard indices == Array(0..<requiredSlotCount) else {
            throw ExtractionError.invalidConfig(
                "Theme \(theme.id) slot indices must be exactly 0...9."
            )
        }
        for slot in theme.slots {
            if let center = slot.expectedCenter,
               center.count != 2 || center[0] < 0 || center[0] > 1 || center[1] < 0 || center[1] > 1 {
                throw ExtractionError.invalidConfig(
                    "Slot \(slot.index) expectedCenter must be [x, y] normalized to 0...1."
                )
            }
            if let filename = slot.safeFilename,
               filename.contains("/") || filename.contains("\\") || filename == "." || filename == ".." {
                throw ExtractionError.invalidConfig("Unsafe slot filename: \(filename)")
            }
        }
    }

    private func visionCandidates(
        image: CGImage,
        width: Int,
        height: Int,
        threshold: UInt8
    ) throws -> [Candidate] {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])
        guard let observation = request.results?.first else {
            throw ExtractionError.vision("Vision returned no foreground observation.")
        }

        var result: [Candidate] = []
        for instanceID in observation.allInstances {
            let instances = IndexSet(integer: instanceID)
            let buffer = try observation.generateScaledMaskForImage(
                forInstances: instances,
                from: handler
            )
            let ciImage = CIImage(cvPixelBuffer: buffer)
            guard let maskCGImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
                continue
            }
            let decoded = try RGBAImage(cgImage: maskCGImage)
            var mask = Array(repeating: UInt8(0), count: width * height)
            if decoded.width == width && decoded.height == height {
                for pixel in 0..<(width * height) {
                    let offset = pixel * 4
                    mask[pixel] = max(
                        decoded.pixels[offset],
                        decoded.pixels[offset + 1],
                        decoded.pixels[offset + 2]
                    )
                }
            } else {
                for y in 0..<height {
                    let sourceY = min(decoded.height - 1, y * decoded.height / height)
                    for x in 0..<width {
                        let sourceX = min(decoded.width - 1, x * decoded.width / width)
                        let offset = (sourceY * decoded.width + sourceX) * 4
                        mask[y * width + x] = max(
                            decoded.pixels[offset],
                            decoded.pixels[offset + 1],
                            decoded.pixels[offset + 2]
                        )
                    }
                }
            }
            guard let stats = maskStats(mask, width: width, height: height, threshold: threshold) else {
                continue
            }
            result.append(Candidate(
                id: "V\(instanceID)",
                source: "vision",
                sourceID: instanceID,
                pixelCount: stats.count,
                box: stats.box,
                centroidX: stats.centroidX,
                centroidY: stats.centroidY,
                pixels: .dense(mask)
            ))
        }
        return result.sorted(by: candidateOrdering)
    }

    private func alphaCandidates(
        image: RGBAImage,
        threshold: UInt8,
        minimumPixels: Int
    ) -> [Candidate] {
        let width = image.width
        let height = image.height
        var visited = Array(repeating: false, count: width * height)
        var components: [(indices: [Int], box: PixelBox, x: Double, y: Double)] = []
        let neighbors = [
            (-1, -1), (0, -1), (1, -1),
            (-1, 0),            (1, 0),
            (-1, 1),  (0, 1),  (1, 1)
        ]

        for start in 0..<(width * height) {
            if visited[start] || image.pixels[start * 4 + 3] < threshold { continue }
            visited[start] = true
            var indices = [start]
            var cursor = 0
            var minX = start % width
            var maxX = minX
            var minY = start / width
            var maxY = minY
            var sumX: Int64 = 0
            var sumY: Int64 = 0

            while cursor < indices.count {
                let pixel = indices[cursor]
                cursor += 1
                let x = pixel % width
                let y = pixel / width
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
                sumX += Int64(x); sumY += Int64(y)

                for (dx, dy) in neighbors {
                    let nextX = x + dx
                    let nextY = y + dy
                    if nextX < 0 || nextX >= width || nextY < 0 || nextY >= height { continue }
                    let next = nextY * width + nextX
                    if visited[next] || image.pixels[next * 4 + 3] < threshold { continue }
                    visited[next] = true
                    indices.append(next)
                }
            }

            guard indices.count >= minimumPixels else { continue }
            components.append((
                indices,
                PixelBox(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1),
                Double(sumX) / Double(indices.count),
                Double(sumY) / Double(indices.count)
            ))
        }

        components.sort {
            if abs($0.y - $1.y) > Double(height) * 0.05 { return $0.y < $1.y }
            if $0.x != $1.x { return $0.x < $1.x }
            return $0.indices.count > $1.indices.count
        }
        return components.enumerated().map { offset, component in
            Candidate(
                id: "A\(offset + 1)",
                source: "alpha",
                sourceID: offset + 1,
                pixelCount: component.indices.count,
                box: component.box,
                centroidX: component.x,
                centroidY: component.y,
                pixels: .sparse(component.indices)
            )
        }
    }

    private func groupCandidates(
        _ candidates: [Candidate],
        slots: [SlotConfig],
        width: Int,
        height: Int,
        maximumDistance: Double,
        includeAllNearest: Bool
    ) -> CandidateGroups {
        var groups: [Int: [Candidate]] = [:]
        for candidate in candidates {
            let normalizedX = candidate.centroidX / Double(width)
            let normalizedY = candidate.centroidY / Double(height)
            let ranked = slots.map { slot -> (SlotConfig, Double) in
                let center = expectedCenter(for: slot)
                let dx = normalizedX - center[0]
                let dy = normalizedY - center[1]
                return (slot, hypot(dx, dy))
            }.sorted { $0.1 < $1.1 }
            guard let nearest = ranked.first, nearest.1 <= maximumDistance else { continue }
            if includeAllNearest || groups[nearest.0.index] == nil {
                groups[nearest.0.index, default: []].append(candidate)
            }
        }
        return CandidateGroups(
            groups: groups,
            mappedSlotCount: slots.filter { groups[$0.index]?.isEmpty == false }.count
        )
    }

    private func expectedCenter(for slot: SlotConfig) -> [Double] {
        if let center = slot.expectedCenter { return center }
        return [
            (Double(slot.index % 5) + 0.5) / 5.0,
            (Double(slot.index / 5) + 0.5) / 2.0
        ]
    }

    private func apply(selection: [UInt8], to source: RGBAImage) -> RGBAImage {
        var output = source
        for pixel in selection.indices {
            let mask = UInt16(selection[pixel])
            let offset = pixel * 4
            output.pixels[offset] = UInt8(UInt16(source.pixels[offset]) * mask / 255)
            output.pixels[offset + 1] = UInt8(UInt16(source.pixels[offset + 1]) * mask / 255)
            output.pixels[offset + 2] = UInt8(UInt16(source.pixels[offset + 2]) * mask / 255)
            output.pixels[offset + 3] = UInt8(UInt16(source.pixels[offset + 3]) * mask / 255)
        }
        return output
    }

    private func alphaBox(_ image: RGBAImage, threshold: UInt8) -> PixelBox? {
        var minX = image.width
        var minY = image.height
        var maxX = -1
        var maxY = -1
        for y in 0..<image.height {
            for x in 0..<image.width where image.pixels[(y * image.width + x) * 4 + 3] >= threshold {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX >= minX, maxY >= minY else { return nil }
        return PixelBox(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    private func maskStats(
        _ mask: [UInt8],
        width: Int,
        height: Int,
        threshold: UInt8
    ) -> (count: Int, box: PixelBox, centroidX: Double, centroidY: Double)? {
        var minX = width
        var minY = height
        var maxX = -1
        var maxY = -1
        var count = 0
        var sumX: Int64 = 0
        var sumY: Int64 = 0
        for y in 0..<height {
            for x in 0..<width where mask[y * width + x] >= threshold {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
                count += 1
                sumX += Int64(x); sumY += Int64(y)
            }
        }
        guard count > 0 else { return nil }
        return (
            count,
            PixelBox(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1),
            Double(sumX) / Double(count),
            Double(sumY) / Double(count)
        )
    }

    private func normalize(
        _ source: RGBAImage,
        sourceBox: PixelBox?,
        canvasSize: Int,
        padding: Int,
        scale: Double,
        offsetX: Double,
        offsetY: Double
    ) -> RGBAImage {
        guard let box = sourceBox else { return RGBAImage(width: canvasSize, height: canvasSize) }
        let maximum = canvasSize - padding * 2
        let fit = min(Double(maximum) / Double(box.width), Double(maximum) / Double(box.height))
        let effective = fit * min(1.0, max(0.05, scale))
        let destinationWidth = max(1, Int((Double(box.width) * effective).rounded()))
        let destinationHeight = max(1, Int((Double(box.height) * effective).rounded()))
        let centeredX = (canvasSize - destinationWidth) / 2 + Int(offsetX.rounded())
        let centeredY = (canvasSize - destinationHeight) / 2 + Int(offsetY.rounded())
        let destinationX = min(max(padding, centeredX), canvasSize - padding - destinationWidth)
        let destinationY = min(max(padding, centeredY), canvasSize - padding - destinationHeight)
        var output = RGBAImage(width: canvasSize, height: canvasSize)

        // The source buffer is premultiplied RGBA. Interpolating all four channels
        // in that representation keeps translucent outlines free of dark fringes.
        for y in 0..<destinationHeight {
            let sampleY = Double(box.y) +
                (Double(y) + 0.5) * Double(box.height) / Double(destinationHeight) - 0.5
            let y0 = max(box.y, min(box.maxY, Int(floor(sampleY))))
            let y1 = max(box.y, min(box.maxY, y0 + 1))
            let fractionY = max(0, min(1, sampleY - Double(y0)))
            for x in 0..<destinationWidth {
                let sampleX = Double(box.x) +
                    (Double(x) + 0.5) * Double(box.width) / Double(destinationWidth) - 0.5
                let x0 = max(box.x, min(box.maxX, Int(floor(sampleX))))
                let x1 = max(box.x, min(box.maxX, x0 + 1))
                let fractionX = max(0, min(1, sampleX - Double(x0)))
                let offsets = [
                    (y0 * source.width + x0) * 4,
                    (y0 * source.width + x1) * 4,
                    (y1 * source.width + x0) * 4,
                    (y1 * source.width + x1) * 4
                ]
                let destinationOffset = ((destinationY + y) * canvasSize + destinationX + x) * 4
                for channel in 0..<4 {
                    let top = Double(source.pixels[offsets[0] + channel]) * (1 - fractionX) +
                        Double(source.pixels[offsets[1] + channel]) * fractionX
                    let bottom = Double(source.pixels[offsets[2] + channel]) * (1 - fractionX) +
                        Double(source.pixels[offsets[3] + channel]) * fractionX
                    let value = top * (1 - fractionY) + bottom * fractionY
                    output.pixels[destinationOffset + channel] = UInt8(clamping: Int(value.rounded()))
                }
            }
        }
        return output
    }

    private func assembleSheet(
        _ slots: [RGBAImage],
        cellSize: Int,
        columns: Int,
        rows: Int
    ) -> RGBAImage {
        var sheet = RGBAImage(width: cellSize * columns, height: cellSize * rows)
        for (index, slot) in slots.enumerated() {
            let originX = (index % columns) * cellSize
            let originY = (index / columns) * cellSize
            for y in 0..<cellSize {
                let sourceStart = y * cellSize * 4
                let destinationStart = ((originY + y) * sheet.width + originX) * 4
                sheet.pixels.replaceSubrange(
                    destinationStart..<(destinationStart + cellSize * 4),
                    with: slot.pixels[sourceStart..<(sourceStart + cellSize * 4)]
                )
            }
        }
        return sheet
    }

    private func makeContactSheet(
        _ slots: [RGBAImage],
        cellSize: Int,
        columns: Int,
        rows: Int
    ) -> RGBAImage {
        var contact = RGBAImage(width: cellSize * columns, height: cellSize * rows)
        for y in 0..<contact.height {
            for x in 0..<contact.width {
                let checker = ((x / 20) + (y / 20)) % 2 == 0 ? UInt8(232) : UInt8(204)
                let offset = (y * contact.width + x) * 4
                contact.pixels[offset] = checker
                contact.pixels[offset + 1] = checker
                contact.pixels[offset + 2] = checker
                contact.pixels[offset + 3] = 255
            }
        }
        for (index, slot) in slots.enumerated() {
            let originX = (index % columns) * cellSize
            let originY = (index / columns) * cellSize
            blend(slot, into: &contact, originX: originX, originY: originY)
            strokeRectangle(
                in: &contact,
                box: PixelBox(x: originX, y: originY, width: cellSize, height: cellSize),
                color: (70, 70, 70, 255),
                thickness: 2
            )
            drawBadge("\(index)", in: &contact, x: originX + 12, y: originY + 12)
        }
        return contact
    }

    private func makeCandidateMap(source: RGBAImage, candidates: [Candidate]) -> RGBAImage {
        var result = RGBAImage(width: source.width, height: source.height)
        for y in 0..<result.height {
            for x in 0..<result.width {
                let checker = ((x / 16) + (y / 16)) % 2 == 0 ? UInt8(238) : UInt8(214)
                let sourceOffset = (y * source.width + x) * 4
                let alpha = UInt16(source.pixels[sourceOffset + 3])
                let inverse = 255 - alpha
                result.pixels[sourceOffset] = UInt8(min(255,
                    UInt16(source.pixels[sourceOffset]) + UInt16(checker) * inverse / 255))
                result.pixels[sourceOffset + 1] = UInt8(min(255,
                    UInt16(source.pixels[sourceOffset + 1]) + UInt16(checker) * inverse / 255))
                result.pixels[sourceOffset + 2] = UInt8(min(255,
                    UInt16(source.pixels[sourceOffset + 2]) + UInt16(checker) * inverse / 255))
                result.pixels[sourceOffset + 3] = 255
            }
        }
        for candidate in candidates.sorted(by: candidateOrdering) {
            let color: (UInt8, UInt8, UInt8, UInt8) = candidate.source == "vision"
                ? (0, 190, 255, 255) : (255, 132, 0, 255)
            strokeRectangle(in: &result, box: candidate.box, color: color, thickness: 3)
            drawBadge(candidate.id, in: &result, x: candidate.box.x + 4, y: candidate.box.y + 4)
        }
        return result
    }

    private func blend(_ source: RGBAImage, into destination: inout RGBAImage, originX: Int, originY: Int) {
        for y in 0..<source.height where originY + y < destination.height {
            for x in 0..<source.width where originX + x < destination.width {
                let sourceOffset = (y * source.width + x) * 4
                let destinationOffset = ((originY + y) * destination.width + originX + x) * 4
                let alpha = UInt16(source.pixels[sourceOffset + 3])
                let inverse = 255 - alpha
                destination.pixels[destinationOffset] = UInt8(min(255,
                    UInt16(source.pixels[sourceOffset]) + UInt16(destination.pixels[destinationOffset]) * inverse / 255))
                destination.pixels[destinationOffset + 1] = UInt8(min(255,
                    UInt16(source.pixels[sourceOffset + 1]) + UInt16(destination.pixels[destinationOffset + 1]) * inverse / 255))
                destination.pixels[destinationOffset + 2] = UInt8(min(255,
                    UInt16(source.pixels[sourceOffset + 2]) + UInt16(destination.pixels[destinationOffset + 2]) * inverse / 255))
                destination.pixels[destinationOffset + 3] = 255
            }
        }
    }

    private func strokeRectangle(
        in image: inout RGBAImage,
        box: PixelBox,
        color: (UInt8, UInt8, UInt8, UInt8),
        thickness: Int
    ) {
        for inset in 0..<thickness {
            let minX = max(0, box.x + inset)
            let minY = max(0, box.y + inset)
            let maxX = min(image.width - 1, box.maxX - inset)
            let maxY = min(image.height - 1, box.maxY - inset)
            guard minX <= maxX, minY <= maxY else { continue }
            for x in minX...maxX {
                setPixel(&image, x: x, y: minY, color: color)
                setPixel(&image, x: x, y: maxY, color: color)
            }
            for y in minY...maxY {
                setPixel(&image, x: minX, y: y, color: color)
                setPixel(&image, x: maxX, y: y, color: color)
            }
        }
    }

    private func drawBadge(_ text: String, in image: inout RGBAImage, x: Int, y: Int) {
        let glyphScale = 4
        let glyphWidth = 5 * glyphScale
        let gap = glyphScale
        let width = max(32, text.count * (glyphWidth + gap) + 12)
        let height = 7 * glyphScale + 12
        fillRectangle(
            in: &image,
            x: x,
            y: y,
            width: width,
            height: height,
            color: (25, 25, 25, 255)
        )
        var cursorX = x + 6
        for character in text.uppercased() {
            guard let rows = glyphs[character] else { continue }
            for (row, bits) in rows.enumerated() {
                for column in 0..<5 where (bits & (1 << (4 - column))) != 0 {
                    fillRectangle(
                        in: &image,
                        x: cursorX + column * glyphScale,
                        y: y + 6 + row * glyphScale,
                        width: glyphScale,
                        height: glyphScale,
                        color: (255, 255, 255, 255)
                    )
                }
            }
            cursorX += glyphWidth + gap
        }
    }

    private let glyphs: [Character: [UInt8]] = [
        "0": [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
        "1": [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
        "2": [0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111],
        "3": [0b11110,0b00001,0b00001,0b01110,0b00001,0b00001,0b11110],
        "4": [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
        "5": [0b11111,0b10000,0b10000,0b11110,0b00001,0b00001,0b11110],
        "6": [0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110],
        "7": [0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
        "8": [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
        "9": [0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b11100],
        "A": [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
        "V": [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100]
    ]

    private func fillRectangle(
        in image: inout RGBAImage,
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        color: (UInt8, UInt8, UInt8, UInt8)
    ) {
        let minX = max(0, x)
        let minY = max(0, y)
        let maxX = min(image.width, x + width)
        let maxY = min(image.height, y + height)
        guard minX < maxX, minY < maxY else { return }
        for row in minY..<maxY {
            for column in minX..<maxX { setPixel(&image, x: column, y: row, color: color) }
        }
    }

    private func setPixel(
        _ image: inout RGBAImage,
        x: Int,
        y: Int,
        color: (UInt8, UInt8, UInt8, UInt8)
    ) {
        guard x >= 0, x < image.width, y >= 0, y < image.height else { return }
        let offset = (y * image.width + x) * 4
        image.pixels[offset] = color.0
        image.pixels[offset + 1] = color.1
        image.pixels[offset + 2] = color.2
        image.pixels[offset + 3] = color.3
    }

    private func safeFilename(for slot: SlotConfig) -> String {
        if let filename = slot.safeFilename, filename.lowercased().hasSuffix(".png") {
            return filename
        }
        return String(format: "%02d-slot.png", slot.index)
    }

    private func sanitizedOutputFilename(_ filename: String) -> String {
        let last = URL(fileURLWithPath: filename).lastPathComponent
        return last.lowercased().hasSuffix(".png") ? last : "\(last).png"
    }

    private func candidateOrdering(_ lhs: Candidate, _ rhs: Candidate) -> Bool {
        if lhs.source != rhs.source { return lhs.source < rhs.source }
        return lhs.sourceID < rhs.sourceID
    }
}

@main
struct ThemeExtractorMain {
    static func main() {
        do {
            let options = try CLIOptions.parse(Array(CommandLine.arguments.dropFirst()))
            guard #available(macOS 14.0, *) else {
                throw ExtractionError.vision(
                    "ThemeExtractor requires macOS 14 or newer for foreground instance masks."
                )
            }
            let data = try Data(contentsOf: options.configURL)
            let decoder = JSONDecoder()
            let rootConfig = try decoder.decode(RootConfig.self, from: data)
            let selectedThemes: [ThemeConfig]
            if options.themeID == "all" {
                selectedThemes = rootConfig.themes
            } else {
                guard let theme = rootConfig.themes.first(where: { $0.id == options.themeID }) else {
                    throw ExtractionError.invalidConfig(
                        "Theme '\(options.themeID)' was not found in \(options.configURL.path)."
                    )
                }
                selectedThemes = [theme]
            }
            guard selectedThemes.isEmpty == false else {
                throw ExtractionError.invalidConfig("The configuration contains no themes.")
            }

            let runRoot = try resolveRunRoot(options: options)
            try prepareRunRoot(runRoot, options: options)
            let runner = ThemeExtractionRunner()
            var failedThemes: [String] = []
            for theme in selectedThemes {
                let sourceURL = try resolveSourceURL(
                    theme: theme,
                    options: options,
                    configURL: options.configURL
                )
                let outputDirectory = runRoot.appendingPathComponent(theme.id, isDirectory: true)
                if FileManager.default.fileExists(atPath: outputDirectory.path) && !options.force {
                    throw ExtractionError.unsafeOutput(
                        "Candidate output already exists: \(outputDirectory.path). Use --force to reuse it."
                    )
                }
                let report = try runner.run(
                    theme: theme,
                    rootConfig: rootConfig,
                    sourceURL: sourceURL,
                    outputDirectory: outputDirectory
                )
                let reportURL = outputDirectory.appendingPathComponent("report.json")
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
                try encoder.encode(report).write(to: reportURL, options: .atomic)
                print("[\(report.passed ? "PASS" : "REVIEW")] \(theme.id): \(outputDirectory.path)")
                if !report.passed { failedThemes.append(theme.id) }
            }
            if failedThemes.isEmpty == false {
                fputs(
                    "Manual review required for: \(failedThemes.joined(separator: ", ")). See report.json and candidate-map.png.\n",
                    stderr
                )
                Foundation.exit(2)
            }
        } catch {
            fputs("ThemeExtractor: \(error.localizedDescription)\n", stderr)
            Foundation.exit(1)
        }
    }

    private static func resolveSourceURL(
        theme: ThemeConfig,
        options: CLIOptions,
        configURL: URL
    ) throws -> URL {
        if let override = options.inputOverride { return override }
        let configured = URL(fileURLWithPath: theme.sourceSheet)
        if configured.path.hasPrefix("/") { return configured.standardizedFileURL }
        let cwdCandidate = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(theme.sourceSheet).standardizedFileURL
        if FileManager.default.fileExists(atPath: cwdCandidate.path) { return cwdCandidate }
        let configCandidate = configURL.deletingLastPathComponent()
            .appendingPathComponent(theme.sourceSheet).standardizedFileURL
        guard FileManager.default.fileExists(atPath: configCandidate.path) else {
            throw ExtractionError.image(
                "Source image not found at \(cwdCandidate.path) or \(configCandidate.path)."
            )
        }
        return configCandidate
    }

    private static func resolveRunRoot(options: CLIOptions) throws -> URL {
        if let output = options.outputOverride { return output.standardizedFileURL }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("scripts/theme-extraction/runs", isDirectory: true)
            .appendingPathComponent(formatter.string(from: Date()), isDirectory: true)
            .standardizedFileURL
    }

    private static func prepareRunRoot(_ runRoot: URL, options: CLIOptions) throws {
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).standardizedFileURL
        let formalAssets = cwd.appendingPathComponent("assets/skins", isDirectory: true).standardizedFileURL
        let isInsideFormalAssets = runRoot.path == formalAssets.path ||
            runRoot.path.hasPrefix(formalAssets.path + "/")
        if isInsideFormalAssets && (!options.allowAssetsOutput || options.outputOverride == nil) {
            throw ExtractionError.unsafeOutput(
                "Refusing formal assets output. Use an explicit --output plus --allow-assets-output."
            )
        }
        if runRoot.path == "/" || runRoot.path == NSHomeDirectory() || runRoot.path == cwd.path {
            throw ExtractionError.unsafeOutput("Refusing broad output directory: \(runRoot.path)")
        }
        if FileManager.default.fileExists(atPath: runRoot.path) && !options.force {
            throw ExtractionError.unsafeOutput(
                "Candidate run directory already exists: \(runRoot.path). Use --force to reuse it."
            )
        }
        try FileManager.default.createDirectory(at: runRoot, withIntermediateDirectories: true)
    }
}
