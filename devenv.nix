{ pkgs, lib, ... }:
let
  nodeMajor = lib.trim (builtins.readFile ./.nvmrc);
in
{
  languages.javascript = {
    enable = true;
    package = pkgs."nodejs_${nodeMajor}";
    npm.enable = true;
  };

  packages = [
    pkgs.git
    pkgs.just
  ];

  # Run npm-managed Playwright browsers through nix-ld on NixOS.
  env = {
    NIX_LD = pkgs.stdenv.cc.bintools.dynamicLinker;
    NIX_LD_LIBRARY_PATH = lib.makeLibraryPath (
      with pkgs;
      [
        alsa-lib
        at-spi2-core
        cairo
        cups
        dbus
        expat
        glib
        libdrm
        libgbm
        libgcc
        libGL
        libxkbcommon
        libX11
        libXcomposite
        libXdamage
        libXext
        libXfixes
        libXrandr
        libxcb
        nspr
        nss
        pango
        systemd
        vulkan-loader
      ]
    );
  };

  # Playwright's dependency check must see the same libraries as its browsers.
  # On Ubuntu, keep using the native loader and apt-installed libraries.
  scripts.ldd.exec = ''
    if [ -e /etc/NIXOS ]; then
      export LD_LIBRARY_PATH="''${LD_LIBRARY_PATH:+$LD_LIBRARY_PATH:}''${NIX_LD_LIBRARY_PATH:?}"
      exec ${pkgs.glibc.bin}/bin/ldd "$@"
    fi
    exec /usr/bin/ldd "$@"
  '';
}
