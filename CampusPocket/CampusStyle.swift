import SwiftUI

/// Kept outside the content archives so existing timetable and article files retain their format.
enum CampusTheme: String, CaseIterable, Identifiable {
  case green, blue, rose, mono
  var id: String { rawValue }
  var name: String { switch self { case .green: "グリーン"; case .blue: "ブルー"; case .rose: "ローズ"; case .mono: "モノトーン" } }
  var accent: Color { Color(hex: tokens.0) }
  var paper: Color { Color(hex: tokens.1) }
  var ink: Color { Color(hex: tokens.2) }
  var soft: Color { Color(hex: tokens.3) }
  var light: Color { Color(hex: tokens.4) }
  private var tokens: (UInt, UInt, UInt, UInt, UInt) {
    switch self {
    case .green: (0x163e35, 0xf6f7f2, 0x223830, 0xedf0e7, 0xdceab9)
    case .blue: (0x233f63, 0xf2f5f9, 0x22374d, 0xe8eef6, 0xd7e6fa)
    case .rose: (0x663e50, 0xfaf4f6, 0x493540, 0xf3e8ed, 0xf4dce7)
    case .mono: (0x2e3339, 0xf5f5f4, 0x2e343b, 0xe9ebed, 0xe0e4ea)
    }
  }
}
extension Color {
  init(hex: UInt) { self.init(.sRGB, red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, opacity: 1) }
}
struct CampusCard<Content: View>: View {
  @EnvironmentObject private var appearance: CampusAppearance
  @ViewBuilder var content: Content
  var body: some View {
    content.padding(18).frame(maxWidth: .infinity, alignment: .leading)
      .background(.white, in: RoundedRectangle(cornerRadius: 22))
      .overlay(RoundedRectangle(cornerRadius: 22).stroke(appearance.theme.accent.opacity(0.09)))
  }
}
struct CampusSectionTitle: View {
  @EnvironmentObject private var appearance: CampusAppearance
  var title: String
  var body: some View { Text(title).font(.headline).padding(.horizontal, 8).padding(.vertical, 6).background(appearance.theme.paper, in: RoundedRectangle(cornerRadius: 8)).padding(.top, 8).accessibilityAddTraits(.isHeader) }
}
struct CampusListStyle: ViewModifier {
  @EnvironmentObject private var appearance: CampusAppearance
  func body(content: Content) -> some View {
    content.listStyle(.insetGrouped).scrollContentBackground(.hidden)
      .listRowSpacing(7).listSectionSpacing(18)
      .campusBackground()
      .navigationBarTitleDisplayMode(.inline)
      .toolbar(.visible, for: .navigationBar)
  }
}
extension View { func campusListStyle() -> some View { modifier(CampusListStyle()) } }
struct CampusPageHeader: View {
  @EnvironmentObject private var appearance: CampusAppearance
  var title: String
  var subtitle = "静岡大学 · 浜松キャンパス"
  var body: some View {
    HStack(alignment: .center) {
      VStack(alignment: .leading, spacing: 6) {
        Text(subtitle).font(.caption2).foregroundStyle(.secondary)
        Text(title).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
      }
      Spacer(minLength: 8)
    }.padding(12).background(appearance.theme.paper, in: RoundedRectangle(cornerRadius: 14))
  }
}
