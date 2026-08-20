# frozen_string_literal: true

source "https://rubygems.org"

# avand.fm is built by GitHub's classic Pages builder, which does not read this
# file -- it builds with its own fixed set of gem versions, published at
# https://pages.github.com/versions.json. The `github-pages` gem is that same
# set, expressed as a dependency, so a local `bundle exec jekyll build` runs the
# Jekyll, kramdown, and Liquid that production runs.
#
# This matters more than it sounds. `gem install jekyll` gets Jekyll 4, while
# Pages is still on 3.10 -- close enough to look fine and far enough apart to
# render differently, which is a bad way to spend an afternoon.
#
# Bump this version when GitHub bumps theirs; the Ruby they build on is in
# that same versions.json, and mise.toml tracks it.
gem "github-pages", "~> 232", group: :jekyll_plugins

# Not part of the Pages gem set, and not needed to build the site. Octokit
# reaches for Faraday's retry middleware, which moved out of Faraday itself in
# v2, and without it every local build opens with a warning about a gem the
# site does not use. Installing it is quieter than reading past it.
gem "faraday-retry", group: :jekyll_plugins
