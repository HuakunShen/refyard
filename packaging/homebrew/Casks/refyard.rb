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

  version "0.2.5"
  sha256 arm:   "d4a6581b81d8ec2ceeb2d4840e20db4f2afc896bd365da73b663d5174ee1b675",
         intel: "6977ff5a899484dc0ecae2ee5d29d0ac278800a2d6157af17fd7a6e92af00855"

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
    # The identifier became tech.huakun.refyard after 0.2.2; zap cleans both so a
    # machine that lived through the change keeps neither the old webview storage nor
    # the new.
    "~/Library/WebKit/dev.refyard.desktop",
    "~/Library/WebKit/tech.huakun.refyard",
  ]
end
