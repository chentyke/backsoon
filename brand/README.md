# BackSoon brand guide

[简体中文](README.zh-CN.md)

![BackSoon social preview](social.png)

The tilted shop sign says the owner will be back soon. The return-key arrow cut into it points back to the chat that started the task. The sign hangs from an amber pin and tilts six degrees counterclockwise. The wordmark stays level.

Write **BackSoon** in prose and `backsoon` for the command, package and skill. The short description is “Background tasks for Codex”. Describe command outcomes and notification delivery separately.

## Mark

The mark sits on a 64-unit grid. The sign has smooth 7-unit corners, and the pin has a 4.6-unit radius with a soft highlight. A 3-unit ink string threads through two eyelets in the sign; on dark backgrounds the string is paper white. The arrow and the eyelets are cutouts, so whatever is behind the logo shows through them at every size. The monochrome mark has no eyelets, because the string would vanish into the sign. Don't fill the arrow, outline the sign or straighten the tilt.

| Use | Asset | Size and spacing |
| --- | --- | --- |
| Documentation and panel header | [Light logo](logo.svg), [dark logo](logo-dark.svg) | At least 112 px wide. Leave half a capital B of space around the logo. |
| Favicon or small icon | [Light mark](mark.svg), [dark mark](mark-dark.svg) | Use the full square canvas, at least 16 px. |
| Single-color print | [Monochrome mark](mark-mono.svg) | Uses the current text color. |
| Profile image | [512 × 512 PNG](avatar.png) | Includes space for a circular crop. |
| Social preview | [1280 × 640 PNG](social.png), [editable SVG](social.svg) | Preserve the aspect ratio. |

## Color

| Color | Value | Use |
| --- | --- | --- |
| Ultramarine | `#344BE4` | The sign on light backgrounds, the social background |
| Pin amber | `#F3A41D` | The pin, and nothing else in the logo |
| Paper | `#FAF7EF` | Light brand background, wordmark and string on dark |
| Ink | `#17213B` | Wordmark and string on light |
| Periwinkle | `#A9B7FF` | The sign on dark backgrounds |

## Panel

The panel carries the same palette into a soft, card-based interface. The light theme puts white cards on `#F4F4F5`. The dark theme puts `#1C1C1F` cards on `#0E0E10`. Cards have no borders: two soft shadows lift them, task rows have 16 px corners and the task window has 28 px corners.

Each situation has one tone: blue while running, amber while waiting or needing input, green for completed, red for failed, orange for interrupted, teal for verified and gray for stopped. A tone always comes with a written status.

Motion follows springs. The task window grows out of its row and folds back into it, changing text blurs in, and a finished task pops its check mark. All of it is skipped when the system asks for reduced motion.

## Type

The outlined wordmark uses [Bricolage Grotesque](https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque), so no font install is needed. The panel uses the system's rounded font where it exists and the system interface font elsewhere. Commands, durations and logs use monospace. The task rows on the social preview use live text in the system font.
