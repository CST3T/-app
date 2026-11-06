"""极简 OOXML（.docx）生成器 —— 只用标准库，Word / WPS 均可直接打开。

文档结构：标题（Heading1）→ 小节（Heading2 / 正文 / 项目符号）。
样式内置于 document.xml，无需 styles.xml 之外的部件。
"""

from __future__ import annotations

import io
import zipfile
from xml.sax.saxutils import escape

XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>
"""

_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

_DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>
"""


def _run(text: str, bold: bool = False, size: int | None = None, color: str | None = None) -> str:
    props = ""
    if bold:
        props += "<w:b/><w:bCs/>"
    if size:
        props += f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    if color:
        props += f'<w:color w:val="{color}"/>'
    props_xml = f"<w:rPr>{props}</w:rPr>" if props else ""
    return (
        '<w:r>'
        f'{props_xml}<w:t xml:space="preserve">{escape(text)}</w:t>'
        '</w:r>'
    )


def _paragraph(text: str, style: str | None = None, numbering: bool = False) -> str:
    props = ""
    if style:
        props += f'<w:pStyle w:val="{style}"/>'
    if numbering:
        props += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    props_xml = f"<w:pPr>{props}</w:pPr>" if props else ""
    return f"<w:p>{props_xml}{_run(text)}</w:p>"


def _heading(text: str, level: int) -> str:
    return _paragraph(text, style=f"Heading{level}")


def build_docx(blocks: list[tuple[str, str]]) -> bytes:
    """blocks: (kind, text)，kind ∈ title/h2/h3/p/bullet/meta/pb(分页)。"""
    body: list[str] = []
    for kind, text in blocks:
        if kind == "title":
            body.append(_paragraph(text, style="Title"))
        elif kind == "h2":
            body.append(_heading(text, 2))
        elif kind == "h3":
            body.append(_heading(text, 3))
        elif kind == "bullet":
            body.append(_paragraph(text, numbering=True))
        elif kind == "meta":
            body.append(
                "<w:p><w:pPr><w:spacing w:after=\"120\"/></w:pPr>"
                f"{_run(text, size=18, color='808080')}</w:p>"
            )
        elif kind == "pb":
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        else:
            body.append(_paragraph(text))

    document = (
        XML_DECL
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + "<w:body>"
        + "".join(body)
        # 内置样式：标题/小节/项目符号，避免依赖 styles.xml
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        + "</w:body></w:document>"
    )

    styles = (
        XML_DECL
        + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        # Title
        + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>'
        + '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:bCs/>'
        + '<w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>'
        # Heading 2
        + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
        + '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:bCs/>'
        + '<w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>'
        # Heading 3
        + '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>'
        + '<w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:bCs/>'
        + '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>'
        # 正文默认字体（中文用微软雅黑/宋体回退）
        + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'
        + '<w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑" w:hAnsi="Calibri"/>'
        + '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>'
        + "</w:styles>"
    )

    numbering = (
        XML_DECL
        + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
        + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>'
        + '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/>'
        + '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>'
        + "</w:abstractNum></w:numbering>"
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _CONTENT_TYPES)
        archive.writestr("_rels/.rels", _RELS)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", _DOC_RELS)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/numbering.xml", numbering)
    return buffer.getvalue()
