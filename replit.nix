# System tools the media commands shell out to. They are looked up on PATH, so
# YTDLP_PATH and FFMPEG_PATH can stay unset here.
#
# openssl is not optional: Prisma's engine and the libsql driver are native
# modules, and a Nix package set does not put them where those binaries expect.
{ pkgs }: {
  deps = [
    pkgs.ffmpeg
    pkgs.python3
    pkgs.yt-dlp
    pkgs.openssl
  ];
}
