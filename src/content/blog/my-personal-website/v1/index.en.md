---
title: 'My GitHub Pages'
---

## Preface

This article records how I built a GitHub Pages site with [Jekyll](https://jekyllrb.com/) and the [Minimal Mistakes](https://github.com/mmistakes/minimal-mistakes) theme. I decided to do this several years ago, but practical considerations kept me from completing it. I am glad to publish the result as my first post.

The site's source code is available [here](https://github.com/sshawn9/sshawn9.github.io).

## Technique details

### Jekyll

Following GitHub's recommendation, I chose Jekyll as the static-site generator. The [step-by-step tutorial](https://jekyllrb.com/docs/step-by-step/01-setup/) is a good place to learn the basic concepts. For subsequent development, the [Jekyll Docker image](https://hub.docker.com/r/jekyll/jekyll/) can be used to build and serve the site locally.

```bash
# Start a container from the Jekyll Docker image
# Port 4000 serves the site at http://localhost:4000
# The image also exposes port 35729
docker run -itd -p 35729:35729 -p 4000:4000 -v $HOME/workspace/sshawn9.github.io:/jekyll --name jekyll jekyll/jekyll bash

# Enter the container
docker exec -it jekyll bash

# Some commonly used commands in the Jekyll container
bundle init # Create the default Gemfile
bundle
bundle update
jekyll serve
```

### Minimal Mistakes theme

Choosing a theme is more convenient than starting from scratch because it allows the author to focus on writing instead of spending as much time on layout and styling. I looked for an elegant theme, but many of the options that met my requirements were not free. Some useful theme directories are:

- <http://jekyllthemes.org/>
- <https://jekyllthemes.io/>

I ultimately returned to [Minimal Mistakes](https://github.com/mmistakes/minimal-mistakes), a widely used theme released under the MIT license. The [mm-github-pages-starter](https://github.com/mmistakes/mm-github-pages-starter) template can be used to create a GitHub Pages repository.

![Creating a GitHub Pages repository from the Minimal Mistakes template](./images/start-with-the-theme-template.png)

Do not overlook the template's [troubleshooting guide](https://github.com/mmistakes/mm-github-pages-starter#troubleshooting). When serving a site created from the template locally, the following Liquid exception may appear:

![Terminal output showing a Liquid exception while running the template locally](./images/liquid-exception.png)

To fix it:

1. Add the following lines to `_config.yml`.

```yaml
# Local hosting:
# Replace these values with your own settings
PAGES_REPO_NWO: sshawn9/sshawn9.github.io
repository: sshawn9/sshawn9.github.io
```

2. Add the following block to `Gemfile`.

```ruby
group :jekyll_plugins do
  gem "kramdown-parser-gfm"
  gem "webrick"
end
```

See the [GitHub Metadata configuration documentation](https://github.com/jekyll/github-metadata/blob/main/docs/configuration.md#configuration) for more information. I chose to ignore the warning `No GitHub API authentication could be found. Some fields may be missing or have incorrect data.`

### Deploying to GitHub

The [Jekyll deployment documentation](https://jekyllrb.com/docs/deployment/) lists several approaches; I chose GitHub Actions. Here is [my GitHub Actions deployment workflow](https://github.com/sshawn9/sshawn9.github.io/blob/main/.github/workflows/jekyll-gh-pages.yml).

## More information

- [Minimal Mistakes GitHub Pages starter-site demo](https://mmistakes.github.io/mm-github-pages-starter/)
- [github-metadata](https://github.com/jekyll/github-metadata)
- [WEBrick](https://jekyllrb.com/docs/configuration/webrick/)

## Favicon

Create `_includes/head/custom.html`; see the [Minimal Mistakes example](https://github.com/mmistakes/minimal-mistakes/blob/master/_includes/head/custom.html) for details.

## TODO

- [ ] Remove the footer containing the feed
- [ ] Try different default layouts
- [ ] [Post with Table of Contents](https://mmistakes.github.io/minimal-mistakes/layout-table-of-contents-post/)
- [ ] Add a [header video](https://mmistakes.github.io/minimal-mistakes/layout/uncategorized/layout-header-video/), header image, or similar media
- [ ] Try a customized sidebar like [this example](https://mmistakes.github.io/minimal-mistakes/docs/quick-start-guide/)
- [ ] Check search engine optimization
- [ ] Learn more about front matter
