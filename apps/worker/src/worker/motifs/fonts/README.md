# Bundled motif fonts

Text motifs use these checked-in static font files so browser, local worker, and Cloud Run never
depend on an installed system font. The source snapshot is Google Fonts commit
`389b770410cc0b7c21c85673bfa2077420fe7f65`.

Both families are distributed under the SIL Open Font License 1.1. The exact license texts are
stored alongside the font files.

| Worker font id | Weight | File | SHA-256 |
| --- | ---: | --- | --- |
| `nanum-gothic` | 400 | `NanumGothic-Regular.ttf` | `76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31` |
| `nanum-gothic` | 700 | `NanumGothic-Bold.ttf` | `f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674` |
| `nanum-myeongjo` | 400 | `NanumMyeongjo-Regular.ttf` | `7ed9e8653a8ed04285d51dc343ffea6eb3d9c73afc27383ea8929ee4ffd03205` |
| `nanum-myeongjo` | 700 | `NanumMyeongjo-Bold.ttf` | `bc9ed8e60d93fe6db054b8fb988481b625f2eef8cb2317ad0e9834681b8fe3f3` |

The font file is part of motif identity: changing any file requires an intentional identity and
regression-test review.
