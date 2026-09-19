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

  version "0.1.1"
  sha256 arm:   "7a4003c4c57106b599bff475f98fd3a752d3817c06c6171a8b894925cecf6eb1",
         intel: "fdb38cb2a28cf550ede40c7102ac115f0266cf383b8097634a76bd4fb2c4e04a"

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
