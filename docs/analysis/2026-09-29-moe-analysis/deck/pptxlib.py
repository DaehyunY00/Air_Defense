# 최소 OOXML PPTX 작성기(표준 라이브러리만) — 16:9, 텍스트 상자·도형·표·선
import zipfile, html
EMU=914400
def emu(v): return int(round(v*EMU))
def esc(t): return html.escape(str(t), quote=False)
NS='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
HEAD_FONT='Malgun Gothic'; BODY_FONT='Malgun Gothic'
class Slide:
    def __init__(s, bg='FFFFFF'): s.parts=[]; s.id=2; s.bg=bg; s.notes=None
    def nid(s): s.id+=1; return s.id
    def _runs(s, runs, size, color, bold, font, italic=False):
        out=[]
        for r in runs:
            if isinstance(r,str): r={'t':r}
            sz=int(r.get('size',size)*100); col=r.get('color',color); b='1' if r.get('b',bold) else '0'; i='1' if r.get('i',italic) else '0'
            fnt=r.get('font',font)
            out.append(f'<a:r><a:rPr lang="ko-KR" sz="{sz}" b="{b}" i="{i}" dirty="0"><a:solidFill><a:srgbClr val="{col}"/></a:solidFill><a:latin typeface="{fnt}"/><a:ea typeface="{fnt}"/></a:rPr><a:t>{esc(r["t"])}</a:t></a:r>')
        return ''.join(out)
    def _paras(s, paras, size, color, bold, align, font, line=None, bullet=False, space=0, italic=False):
        out=[]
        for p in paras:
            if isinstance(p,(str,dict)) or (isinstance(p,list) and p and isinstance(p[0],(str,dict)) and not isinstance(p,tuple)):
                pass
            runs = p if isinstance(p,list) else [p]
            pb = bullet
            if isinstance(runs[0],dict) and 'bullet' in runs[0]: pb=runs[0]['bullet']
            algn={'l':'l','c':'ctr','r':'r'}[align]
            ppr=f'<a:pPr algn="{algn}"'
            if pb: ppr+=' marL="228600" indent="-228600"'
            ppr+='>'
            if line: ppr+=f'<a:lnSpc><a:spcPct val="{int(line*100000)}"/></a:lnSpc>'
            if space: ppr+=f'<a:spcAft><a:spcPts val="{int(space*100)}"/></a:spcAft>'
            ppr+= '<a:buChar char="•"/>' if pb else '<a:buNone/>'
            ppr+='</a:pPr>'
            out.append(f'<a:p>{ppr}{s._runs(runs,size,color,bold,font,italic)}</a:p>')
        return ''.join(out)
    def text(s, x,y,w,h, paras, size=14, color='1D2A35', bold=False, align='l', valign='t', font=None, line=None, bullet=False, space=0, fill=None, lncolor=None, margin=0.05, italic=False, shape='rect', wrap=True, anchor=None):
        font=font or BODY_FONT; i=s.nid()
        if isinstance(paras,(str,dict)): paras=[paras]
        fillx=f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else '<a:noFill/>'
        ln=f'<a:ln w="12700"><a:solidFill><a:srgbClr val="{lncolor}"/></a:solidFill></a:ln>' if lncolor else '<a:ln><a:noFill/></a:ln>'
        geom='roundRect' if shape=='round' else ('ellipse' if shape=='ellipse' else 'rect')
        adj='<a:avLst><a:gd name="adj" fmla="val 12000"/></a:avLst>' if geom=='roundRect' else '<a:avLst/>'
        anc={'t':'t','m':'ctr','b':'b'}[valign]
        m=emu(margin)
        s.parts.append(f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Text {i}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="{geom}">{adj}</a:prstGeom>{fillx}{ln}</p:spPr><p:txBody><a:bodyPr wrap="{"square" if wrap else "none"}" lIns="{m}" tIns="{m}" rIns="{m}" bIns="{m}" anchor="{anc}" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>{s._paras(paras,size,color,bold,align,font,line,bullet,space,italic)}</p:txBody></p:sp>')
    def rect(s, x,y,w,h, fill, shape='rect', lncolor=None, lnw=1):
        i=s.nid(); geom='roundRect' if shape=='round' else ('ellipse' if shape=='ellipse' else 'rect')
        adj='<a:avLst><a:gd name="adj" fmla="val 12000"/></a:avLst>' if geom=='roundRect' else '<a:avLst/>'
        ln=f'<a:ln w="{int(lnw*12700)}"><a:solidFill><a:srgbClr val="{lncolor}"/></a:solidFill></a:ln>' if lncolor else '<a:ln><a:noFill/></a:ln>'
        s.parts.append(f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Shape {i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="{geom}">{adj}</a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>{ln}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></p:txBody></p:sp>')
    def line(s, x1,y1,x2,y2, color='143D5C', w=1.5, dash=None, arrow=False):
        i=s.nid(); flipH = x2<x1; flipV=y2<y1
        x=min(x1,x2); y=min(y1,y2); cx=abs(x2-x1); cy=abs(y2-y1)
        d=f'<a:prstDash val="{dash}"/>' if dash else ''
        a='<a:tailEnd type="triangle"/>' if arrow else ''
        fl=(' flipH="1"' if flipH else '')+(' flipV="1"' if flipV else '')
        s.parts.append(f'<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{i}" name="Line {i}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm{fl}><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(cx)}" cy="{emu(cy)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="{int(w*12700)}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>{d}{a}</a:ln></p:spPr></p:cxnSp>')
    def table(s, x,y,w, rows, colw, size=11, header_fill='143D5C', header_color='FFFFFF', rowh=0.32, band=('FFFFFF','F3F6F8'), font=None, line_color='C9D2DA', first_col_bold=False, aligns=None):
        font=font or BODY_FONT; i=s.nid(); tw=sum(colw); scale=w/tw; cws=[c*scale for c in colw]
        nrows=len(rows); h=rowh*nrows
        grid=''.join(f'<a:gridCol w="{emu(c)}"/>' for c in cws)
        trs=[]
        for ri,row in enumerate(rows):
            tcs=[]
            for ci,cell in enumerate(row):
                if not isinstance(cell,dict): cell={'t':cell}
                fill = header_fill if ri==0 else cell.get('fill', band[ri%2])
                col = header_color if ri==0 else cell.get('color','1D2A35')
                b = True if ri==0 else cell.get('b', first_col_bold and ci==0)
                al = (aligns[ci] if aligns else ('l' if ci==0 else 'l')); al=cell.get('align',al)
                sz=cell.get('size',size)
                runs = cell['t'] if isinstance(cell['t'],list) else [cell['t']]
                paras=[]
                for ln_ in (runs if (runs and isinstance(runs[0],list)) else [runs]):
                    paras.append(f'<a:p><a:pPr algn="{ {"l":"l","c":"ctr","r":"r"}[al] }"/>{s._runs(ln_ if isinstance(ln_,list) else [ln_],sz,col,b,font)}</a:p>')
                lnx=''.join(f'<a:ln{side} w="6350"><a:solidFill><a:srgbClr val="{line_color}"/></a:solidFill></a:ln{side}>' for side in ['L','R','T','B'])
                tcs.append(f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{"".join(paras)}</a:txBody><a:tcPr marL="54864" marR="54864" marT="36576" marB="36576" anchor="ctr">{lnx}<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill></a:tcPr></a:tc>')
            trs.append(f'<a:tr h="{emu(rowh)}">{"".join(tcs)}</a:tr>')
        s.parts.append(f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{i}" name="Table {i}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>{grid}</a:tblGrid>{"".join(trs)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>')
    def xml(s):
        bg=f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{s.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
        return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}><p:cSld>{bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{"".join(s.parts)}</p:spTree></p:cSld><a:clrMapOvr><a:masterClrMapping/></a:clrMapOvr></p:sld>'
def write(path, slides, title='Deck'):
    W,H=emu(13.333),emu(7.5)
    z=zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED)
    n=len(slides)
    ct='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'+''.join(f'<Override PartName="/ppt/slides/slide{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(n))+'</Types>'
    z.writestr('[Content_Types].xml',ct)
    z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>')
    z.writestr('docProps/core.xml',f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{esc(title)}</dc:title><dc:creator>K-JAMDS</dc:creator></cp:coreProperties>')
    z.writestr('docProps/app.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><Slides>'+str(n)+'</Slides></Properties>')
    sldids=''.join(f'<p:sldId id="{256+i}" r:id="rId{10+i}"/>' for i in range(n))
    z.writestr('ppt/presentation.xml',f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation {NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{sldids}</p:sldIdLst><p:sldSz cx="{W}" cy="{H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr></p:defaultTextStyle></p:presentation>')
    rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>'+''.join(f'<Relationship Id="rId{10+i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i+1}.xml"/>' for i in range(n))+'</Relationships>'
    z.writestr('ppt/_rels/presentation.xml.rels',rels)
    z.writestr('ppt/presProps.xml',f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr {NS}/>')
    z.writestr('ppt/viewProps.xml',f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr {NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>')
    z.writestr('ppt/tableStyles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>')
    master=f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster {NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>'
    z.writestr('ppt/slideMasters/slideMaster1.xml',master)
    z.writestr('ppt/slideMasters/_rels/slideMaster1.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>')
    z.writestr('ppt/slideLayouts/slideLayout1.xml',f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout {NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')
    z.writestr('ppt/slideLayouts/_rels/slideLayout1.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>')
    theme='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="KJAMDS"><a:themeElements><a:clrScheme name="KJAMDS"><a:dk1><a:srgbClr val="1D2A35"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="143D5C"/></a:dk2><a:lt2><a:srgbClr val="E8EDF1"/></a:lt2><a:accent1><a:srgbClr val="143D5C"/></a:accent1><a:accent2><a:srgbClr val="B3261E"/></a:accent2><a:accent3><a:srgbClr val="1B7F3B"/></a:accent3><a:accent4><a:srgbClr val="0E7490"/></a:accent4><a:accent5><a:srgbClr val="F59E0B"/></a:accent5><a:accent6><a:srgbClr val="7C3AED"/></a:accent6><a:hlink><a:srgbClr val="0E7490"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="KJAMDS"><a:majorFont><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
    z.writestr('ppt/theme/theme1.xml',theme)
    for i,sl in enumerate(slides):
        z.writestr(f'ppt/slides/slide{i+1}.xml', sl.xml())
        z.writestr(f'ppt/slides/_rels/slide{i+1}.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>')
    z.close()

# ── HTML 미리보기(같은 좌표계 · 96px/in) — 헤드리스 크롬으로 QA ──
PX=96
def _html_runs(runs,size,color,bold,italic):
    out=[]
    for r in runs:
        if isinstance(r,str): r={'t':r}
        st=f"font-size:{r.get('size',size)*PX/72:.1f}px;color:#{r.get('color',color)};font-weight:{700 if r.get('b',bold) else 400};font-style:{'italic' if r.get('i',italic) else 'normal'}"
        out.append(f'<span style="{st}">{esc(r["t"]).replace(chr(10),"<br>")}</span>')
    return ''.join(out)
def _html_paras(paras,size,color,bold,align,line,bullet,space,italic):
    out=[]
    for p in paras:
        runs = p if isinstance(p,list) else [p]
        pb=bullet
        if isinstance(runs[0],dict) and 'bullet' in runs[0]: pb=runs[0]['bullet']
        al={'l':'left','c':'center','r':'right'}[align]
        st=f"text-align:{al};margin:0 0 {space*PX/72 if space else 0:.1f}px 0;line-height:{line if line else 1.2};"
        if pb: st+="padding-left:0.24in;text-indent:-0.24in;"
        out.append(f'<div style="{st}">{"• " if pb else ""}{_html_runs(runs,size,color,bold,italic)}</div>')
    return ''.join(out)
_orig_text=Slide.text; _orig_rect=Slide.rect; _orig_line=Slide.line; _orig_table=Slide.table; _orig_init=Slide.__init__
def _init(s,bg='FFFFFF'): _orig_init(s,bg); s.html=[]
def _text(s,x,y,w,h,paras,size=14,color='1D2A35',bold=False,align='l',valign='t',font=None,line=None,bullet=False,space=0,fill=None,lncolor=None,margin=0.05,italic=False,shape='rect',wrap=True,anchor=None):
    _orig_text(s,x,y,w,h,paras,size,color,bold,align,valign,font,line,bullet,space,fill,lncolor,margin,italic,shape,wrap,anchor)
    if isinstance(paras,(str,dict)): paras=[paras]
    jc={'t':'flex-start','m':'center','b':'flex-end'}[valign]
    st=f"position:absolute;left:{x*PX}px;top:{y*PX}px;width:{w*PX}px;height:{h*PX}px;box-sizing:border-box;padding:{margin*PX}px;display:flex;flex-direction:column;justify-content:{jc};overflow:visible;"
    st+=f"background:#{fill};" if fill else ""
    st+=f"border:1px solid #{lncolor};" if lncolor else ""
    st+="border-radius:10px;" if shape=='round' else ("border-radius:50%;" if shape=='ellipse' else "")
    st+="white-space:nowrap;" if not wrap else ""
    s.html.append(f'<div class="tb" style="{st}">{_html_paras(paras,size,color,bold,align,line,bullet,space,italic)}</div>')
def _rect(s,x,y,w,h,fill,shape='rect',lncolor=None,lnw=1):
    _orig_rect(s,x,y,w,h,fill,shape,lncolor,lnw)
    st=f"position:absolute;left:{x*PX}px;top:{y*PX}px;width:{w*PX}px;height:{h*PX}px;background:#{fill};box-sizing:border-box;"
    st+=f"border:{lnw}px solid #{lncolor};" if lncolor else ""
    st+="border-radius:10px;" if shape=='round' else ("border-radius:50%;" if shape=='ellipse' else "")
    s.html.append(f'<div style="{st}"></div>')
def _line(s,x1,y1,x2,y2,color='143D5C',w=1.5,dash=None,arrow=False):
    _orig_line(s,x1,y1,x2,y2,color,w,dash,arrow)
    da = 'stroke-dasharray="6 4"' if dash else ''; ma = 'marker-end="url(#ah)"' if arrow else ''
    s.html.append(f'<svg style="position:absolute;left:0;top:0;width:{13.333*PX}px;height:{7.5*PX}px;pointer-events:none" viewBox="0 0 {13.333*PX} {7.5*PX}"><line x1="{x1*PX}" y1="{y1*PX}" x2="{x2*PX}" y2="{y2*PX}" stroke="#{color}" stroke-width="{w}" {da} {ma}/></svg>')
def _table(s,x,y,w,rows,colw,size=11,header_fill='143D5C',header_color='FFFFFF',rowh=0.32,band=('FFFFFF','F3F6F8'),font=None,line_color='C9D2DA',first_col_bold=False,aligns=None):
    _orig_table(s,x,y,w,rows,colw,size,header_fill,header_color,rowh,band,font,line_color,first_col_bold,aligns)
    tw=sum(colw); cws=[c/tw*100 for c in colw]
    trs=[]
    for ri,row in enumerate(rows):
        tds=[]
        for ci,cell in enumerate(row):
            if not isinstance(cell,dict): cell={'t':cell}
            fill = header_fill if ri==0 else cell.get('fill', band[ri%2]); col = header_color if ri==0 else cell.get('color','1D2A35')
            b = True if ri==0 else cell.get('b', first_col_bold and ci==0); al=cell.get('align',(aligns[ci] if aligns else 'l')); sz=cell.get('size',size)
            runs = cell['t'] if isinstance(cell['t'],list) else [cell['t']]
            lines = runs if (runs and isinstance(runs[0],list)) else [runs]
            inner='<br>'.join(_html_runs(l if isinstance(l,list) else [l],sz,col,b,False) for l in lines)
            tds.append(f'<td style="width:{cws[ci]:.2f}%;background:#{fill};border:0.5px solid #{line_color};padding:3px 4px;text-align:{ {"l":"left","c":"center","r":"right"}[al] };vertical-align:middle;min-height:{rowh*PX}px">{inner}</td>')
        trs.append(f'<tr style="height:{rowh*PX}px">{"".join(tds)}</tr>')
    s.html.append(f'<table style="position:absolute;left:{x*PX}px;top:{y*PX}px;width:{w*PX}px;border-collapse:collapse;table-layout:fixed;line-height:1.25">{"".join(trs)}</table>')
Slide.__init__=_init; Slide.text=_text; Slide.rect=_rect; Slide.line=_line; Slide.table=_table
def write_html(path, slides):
    pages=[]
    for i,sl in enumerate(slides):
        pages.append(f'<div class="slide" style="position:relative;width:{13.333*PX}px;height:{7.5*PX}px;background:#{sl.bg};overflow:hidden;margin:0 0 12px 0;outline:1px solid #999"><svg width="0" height="0"><defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#143D5C"/></marker></defs></svg>{"".join(sl.html)}<div style="position:absolute;right:6px;bottom:2px;font-size:10px;color:#888">{i+1}</div></div>')
    open(path,'w',encoding='utf-8').write('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#666;font-family:"Malgun Gothic","Noto Sans KR","WenQuanYi Zen Hei",sans-serif}.tb div{word-break:keep-all;overflow-wrap:anywhere}</style></head><body>'+''.join(pages)+'</body></html>')
