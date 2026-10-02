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
#   brew install --cask HuakunShen/tap/refyard
#
cask "refyard" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.3"
  sha256 arm:   "f4f25f8b143bae23d56b2e77ff2f1f16710530bb0bb35cd1c91a7a156a7f7a2e",
         intel: "5c340f980f27cdb8664c9845e78994c6e08e567d9b2ca7d96fefef18c713074f"

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

  app "Refyard.app"

  zap trash: [
    "~/Library/Application Support/refyard",
    "~/Library/WebKit/dev.refyard.desktop",
  ]
end
