# The Homebrew cask for the Refyard desktop app.
#
# This file lives in the Refyard repository as the source of truth; each release, the
# version and the two sha256 values are filled from the real release artifacts and the
# result is pushed to `HuakunShen/homebrew-tap` as `Casks/refyard.rb` (the push is the
# owner's action — this repository never pushes).
#
# After a release exists, fill the sha256 values with:
#   shasum -a 256 <(curl -sL <dmg url>)   # or: brew fetch --cask after tapping
# then verify locally with:
#   brew audit --cask refyard
#   brew install --cask HuakunShen/refyard/refyard
#
# `auto_updates true` is load-bearing: the app updates itself from the release feed
# (tauri updater), so `brew upgrade` must not fight it — Homebrew will recognise the
# newer installed version instead of reinstalling.
cask "refyard" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "c2b2676f827c9c8b4cd83e6954c2205980995bd9aec9e77df5db11612c11ff31",
         intel: "e87c3c45748cc9ddd9bfb31403df94b9eb7cd4ee3085119e1bd4682c271e1889"

  url "https://github.com/HuakunShen/refyard/releases/download/app-v#{version}/Refyard_#{version}_#{arch}.dmg"
  name "Refyard"
  desc "Local-first Git workbench: a beautiful graph without giving up your repository"
  homepage "https://github.com/HuakunShen/refyard"

  livecheck do
    url "https://github.com/HuakunShen/refyard/releases/latest"
    strategy :github_latest do |json|
      json["tag_name"]&.sub(/^app-v/, "")
    end
  end

  auto_updates true

  app "Refyard.app"

  zap trash: [
    "~/Library/Application Support/refyard",
    "~/Library/WebKit/dev.refyard.desktop",
  ]
end
