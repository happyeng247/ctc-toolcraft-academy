from pathlib import Path
import json, re

root=Path(__file__).resolve().parent.parent
work=root/'src'
data={k:[] for k in ['modules','glossary','sources','processSteps','roadmap','briefFields','diagnostics','fieldwork']}
for filename in ['foundations.json','manufacturing.json','ai-playbook.json']:
    part=json.loads((work/filename).read_text())
    for key in data:
        data[key].extend(part.get(key,[]))
    for module in part['modules']:
        data['sources'].extend(module.get('sources',[]))
data['sources'].append({'title':'Sandvik Coromant — Milling formulas and definitions (metric)','url':'https://cdn.sandvik.coromant.com/files/sitecollectiondocuments/services/metal-cutting-e-learning/formulas-and-definitions/formulas-and-deinitions-for-milling-metric-enu.pdf'})
data['sources'].append({'title':'DAPRA — Radial chip thinning geometry','url':'https://www.dapra.com/articles/radial-chip-thinning'})
data['sources']=list({s['url']:s for s in data['sources']}.values())
data['glossary'].extend([
 {'term':'Tool Sketcher','definition':'Rollomatic software for creating annotated 2D drawings from 3D tool simulations in VirtualGrind Pro. A drawing export is not a machine program or proof of cutting performance.'},
 {'term':'VirtualGrind Pro','definition':'Rollomatic programming and simulation software associated with GrindSmart tool grinding machines. Installed version, options and machine configuration must be recorded.'},
 {'term':'As-designed / as-built','definition':'The intended geometry and specification versus the measured tool actually produced. Link both records to the same released revision and traceable tool or batch.'},
 {'term':'Gage R&R','definition':'A measurement-system study separating repeatability and reproducibility contributions under the study conditions. It helps determine whether measured differences are meaningful.'},
 {'term':'Cpk','definition':'A process capability index comparing the process mean and variation with specification limits. Interpretation requires a suitable measurement system, process stability and justified statistical assumptions.'},
 {'term':'Design family','definition':'A group of tools sharing an application and design logic, not merely a visual resemblance. Families can support controlled parameter reuse and meaningful evaluation of an AI assistant.'},
 {'term':'Data leakage','definition':'When information unavailable at the real decision, or a near-duplicate related record, enters the evaluation data in a way that makes an AI system look better than it will perform.'},
 {'term':'Release gate','definition':'A defined decision point at which a responsible engineer accepts the required evidence before a revision proceeds to manufacture, trial or production.'}
])
data['glossary']=sorted({g['term'].lower():g for g in data['glossary']}.values(),key=lambda g:g['term'].lower())
for step in data['processSteps']:
    step['title']=re.sub(r'^\d+\.\s*','',step['title'])
for week in data['fieldwork']:
    week['week']='Week '+str(week['week'])
assert len({m['id'] for m in data['modules']})==len(data['modules'])
for m in data['modules']:
    assert 0<=m['quiz']['correct']<len(m['quiz']['options'])
    assert all(m.get(k) for k in ['id','title','subtitle','group','objectives','sections','exercise','quiz'])
html=(work/'template.html').read_text()
runtime=(work/'vendor/three.min.js').read_text()
license=(work/'vendor/THREE-LICENSE.txt').read_text()
runtime='/*\n'+license.replace('*/','* /')+'\n*/\n'+runtime
for token,value in {'__STYLES__':(work/'styles.css').read_text()+'\n'+(work/'voice.css').read_text(),'__THREE__':runtime,'__DATA__':json.dumps(data,ensure_ascii=False).replace('</','<\/'),'__APP__':(work/'app.js').read_text(),'__VOICE_CONFIG__':json.dumps(json.loads((work/'voice-config.json').read_text())).replace('</','<\/'),'__VOICE_CONTENT__':(work/'voice-content.js').read_text(),'__VOICE__':(work/'voice.js').read_text()}.items():
    html=html.replace(token,value)
out=root/'docs'
out.mkdir(exist_ok=True)
(out/'index.html').write_text(html)
(out/'THREE-LICENSE.txt').write_text(license)
print(f'Built {len(html.encode()):,} bytes; {len(data["modules"])} lessons; {len(data["glossary"])} terms; {len(data["sources"])} primary references.')
