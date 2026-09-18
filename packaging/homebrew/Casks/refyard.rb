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

  version "0.1.0"
  sha256 arm:   "38da919e2b412bac6480afa3a6bd08cb4c1d07004166ef33c3a1ee4de1a206bf",
         intel: "0b727b3a167c3906322e112db8b754ee5b755cf5afb7b941f41f199b2c4533bb"

  url "https://github.com/HuakunShen/refyard/releases/download/app-v#{version}/Refyard_#{version}_#{arch}.dmg",
      verified: "github.com/HuakunShen/refyard/"
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
  depends_on macos: ">= :catalina"

  app "Refyard.app"

  zap trash: [
    "~/Library/Application Support/refyard",
    "~/Library/WebKit/dev.refyard.desktop",
  ]
end
