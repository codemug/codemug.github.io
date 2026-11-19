Casual Sheets local desktop integration

SDK: @casualoffice/sheets 0.20.0, published npm package, pinned by integrity
in package-lock.json. Its embed runtime and workers are copied without changes.
Source: https://github.com/CasualOffice/sheets
Reviewed commit: 87a63902d94c85b3c50d3210055373a3d3bae991

LICENSE and NOTICE are verbatim copies from that source commit. The package
metadata declares Apache-2.0; the actual upstream license text is retained.
BUNDLED-NOTICES.txt also reproduces the license comments retained inside the
runtime and worker bundles. All original bundle comments remain in the assets.

Supporting licenses:
- Univer 0.25.0: univer-LICENSE (upstream v0.25.0 LICENSE)
- React / React DOM: react-LICENSE (upstream v19.2.0 LICENSE)
- RxJS: rxjs-LICENSE (upstream 7.8.2 LICENSE.txt)
- ExcelJS 4.4.0: exceljs-LICENSE (installed package)
- ECharts 6.0.0: echarts-LICENSE and echarts-NOTICE (installed package)
- ZRender: zrender-LICENSE (installed ECharts dependency)
- JSZip: jszip-LICENSE (installed ExcelJS dependency; MIT option)
- Pako: pako-LICENSE (installed dependency)

Fonts are self-hosted, with no Google Fonts network requests:
- @fontsource-variable/inter 5.3.0: inter-LICENSE
- @fontsource-variable/material-symbols-outlined 5.3.9:
  material-symbols-outlined-LICENSE

Integration source and update instructions: scripts/pc/sheets/README.md in
this site's source repository. The authored wrapper and empty bootstrap XLSX
are separate from the unchanged third-party SDK bundles.
