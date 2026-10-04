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

  version "0.2.6"
  sha256 arm:   "b882811832bb6d1b96b47662f76f1cf8e1b073261c625ff036dc4a89586fd8f0",
         intel: "2aba5294366530ede896a996da03a24e659d13a125a890c8a3896333f1cb0c3b"

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
