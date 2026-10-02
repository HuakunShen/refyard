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

  version "0.2.4"
  sha256 arm:   "2fa1730abad4060655b721fa69f2e59695f15d6ecb400f7920d8843d608ede23",
         intel: "ad1ec0977deda97cae217c0557c2afe27b17d1350c0c07234b7795d76b833128"

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
