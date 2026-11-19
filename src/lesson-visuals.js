/* Self-contained schematic teaching scenes; no network or production geometry. */
(() => {
'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const C={ink:0x0d253d,navy:0x1c1e54,indigo:0x665efd,lavender:0xb9b9f9,steel:0x9aadc3,silver:0xd8e1ec,cream:0xf5e9d4,copper:0xc99d67,ruby:0xea2261,paper:0xffffff,faint:0xe7edf5};
const DEFINITIONS={
'cutting-system':['system',['A grinding wheel makes the tool. The finished tool then cuts the customer’s part.','Follow the connections: holder, cutting tool, part and clamps all need to stay steady.','The jaws check size. The cross marks position. These are separate requirements.','The outlined shape helps explain an idea; dimensions and cutting trials still matter.']],
 'tool-anatomy':['anatomy',['The holder grips the smooth shank. The grooved end cuts and lets chips leave.','Watch the chip travel up the front face and the gap behind the cutting edge.','The outside sizes match. More flutes leave less space between the cutting edges.','The long tool bends more under the same sideways push. Motion is exaggerated to make this visible.']],
'chip-mechanics':['chips',['A chip separates near the edge, then has to leave the cutting area.','Rotation and forward travel are different movements. Watch both together.','One edge takes a changing bite as it enters and leaves the material.','The cutting push travels through both the tool and the part into their supports.']],
'workpiece-materials':['materials',['Both blocks represent aluminium. Different grades and conditions can still need different choices.','Curling chips, broken fragments and layers illustrate different material behaviours.','Material can stick to an edge or wear it away. Look at the contact, not just the material name.','One drill crosses different materials in a layered part.']],
'tool-materials':['toolmaterials',['The enlarged carbide grains sit in a binder. Both wear and sudden damage matter.','The purple PCD cutting layer is supported by backing and the tool body.','A thin coating, a PCD segment and a single crystal are different constructions.','A supported cutting segment needs suitable shaping, joining and inspection.']],
'milling-operations':['milling',['The cutter’s side makes the wall; its end can make the floor of the pocket.','The shaded contact gets wider as the cutter moves into the material.','Conventional milling grows a chip from thin to thick; climb milling goes from thick to thin.','Nearby passes of a rounded tool leave small ridges called scallops.']],
'holemaking':['holes',['The point starts the cut. Spiral grooves carry chips away from the hole.','Chips move up while the drill pushes down and rotates. A deeper hole is a longer exit route.','Drilling makes the hole. Reaming removes a small allowance from an existing hole.','Diameter, location and the condition of the wall are separate checks.']],
'pcb-tools':['pcb',['The drill crosses copper-coloured layers and insulating board material.','An entry sheet sits above the boards; backing supports the exit below.','The enlarged hole wall shows possible residue. An open hole can still have a defect.','The router’s side cuts the outline as it travels around the board.']],
'failure-diagnosis':['failure',['Point to the damaged area before deciding what caused it.','Compare wear, a chipped edge and material stuck to an edge.','The exaggerated off-centre path shows runout. Check the holder and alignment too.','Compare the baseline with one planned change under matching conditions.']],
'mfg-requirements':['requirements',['Begin with the feature the customer needs on the part.','Material, feature and available setup come together before tool selection.','The target outline and measuring jaws show why a drawing needs clear limits.','Two tool versions differ in one feature. Keep their drawing and approval records connected.','Follow a request to the tool and the checked part, carrying the matching records along.']],
'mfg-carbide':['grinding',['The blank has the starting material and size; it does not yet have all its cutting features.','The rotating grinding wheel removes small amounts of material at the contact.','Wheel travel and blank rotation combine to make a spiral flute.','The conditioning tool helps restore the wheel’s working surface and shape.','The blank, shaped cutter and inspection stage belong to the same job.']],
'mfg-pcd':['pcdmake',['A typical PCD segment has a diamond layer and supporting backing.','The amber layer represents a brazed joint between the supported segment and body.','Grinding uses contact, EDM uses discharges and laser machining uses a beam.','Compare the target edge with visible chipping. The process name alone does not prove quality.','Connect the finished tip with its inspection and manufacturing record.']],
'mfg-rollomatic':['rollomatic',['This model stands for a tool grinder. Confirm the capabilities of your actual equipment.','Tool Sketcher turns a 3D simulation in VirtualGrind Pro into a 2D drawing.','Preparing blanks, grinding tools and shaping superhard edges are different process families.','Compare the simulated shape with the made tool, then measure the result.','A changed core diameter must follow through the model, drawing and measured tool.']],
'mfg-quality':['quality',['The jaws measure tool diameter. Other features need their own suitable checks.','Repeated checks on the same feature help reveal variation in the measurement method.','Measurements shown in production order help reveal changes over time.','Matching trial conditions let you compare a baseline tool with a candidate fairly.','Connect the inspected tool to evidence from the finished part and cutting trial.']],
'ai-design-system':['aiflow',['Start with the part feature, material and setup. Missing information needs a question.','Suggestions move through checks, trials and engineering approval. AI does not skip these steps.','Connect a drawing, the made tool and its trial results around the same job.','A solid candidate stands for a supported option; the outlined one still has missing evidence.','A valid shape and a successful cutting trial answer two different questions.']],
'knowledge-and-collaboration':['team',['The marker pauses between stages. Look for specific handoffs where work waits.','Use an earlier tool, a changed version and the evidence to explain a decision.','Keep suggestions, engineering checks and measured results clearly identified.','The tool and its record move together between design, manufacturing and quality.','Less waiting and fewer repeated questions should make the next real job easier.']],
'portfolio-and-experiments':['portfolio',['Compare what each tool does and what its cutting edge is made from. A PCD tool can drill or mill.','Keep the intended design, the made tool and what happened in use as separate linked records.','Compare a baseline and a planned change in matching setups.','Keep closely related versions together when separating examples for training and testing AI.','Judge useful output: accepted parts, rejected parts and the total effort spent.']]
};
let active=null;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const cycle=(t,s=6)=>(t%s)/s;
const triangle=(t,s=6)=>1-Math.abs(2*cycle(t,s)-1);
function kit(T,group){
 const labels=[];
 const linear=color=>new T.Color(color).convertSRGBToLinear();
 const material=(color=C.steel,extra={})=>new T.MeshStandardMaterial({color:linear(color),roughness:.48,metalness:.15,...extra});
 const add=(geometry,color,x=0,y=0,z=0,extra={})=>{const m=new T.Mesh(geometry,material(color,extra));m.position.set(x,y,z);group.add(m);return m};
 const box=(w,h,d,color,x=0,y=0,z=0,extra={})=>add(new T.BoxGeometry(w,h,d),color,x,y,z,extra);
 const cyl=(r,h,color,x=0,y=0,z=0,extra={})=>add(new T.CylinderGeometry(r,r,h,40),color,x,y,z,extra);
 const ball=(r,color,x=0,y=0,z=0)=>add(new T.SphereGeometry(r,16,12),color,x,y,z);
 const line=(pts,color=C.indigo,dashed=false)=>{const geo=new T.BufferGeometry().setFromPoints(pts.map(p=>new T.Vector3(...p)));const o=new T.Line(geo,dashed?new T.LineDashedMaterial({color:linear(color),dashSize:.13,gapSize:.1}):new T.LineBasicMaterial({color:linear(color)}));if(dashed)o.computeLineDistances();group.add(o);return o};
 const ring=(r,color,x,y,z,rx=Math.PI/2)=>{const o=add(new T.TorusGeometry(r,.02,6,64),color,x,y,z);o.rotation.x=rx;return o};
 const arrow=(from,to,color=C.indigo)=>{const a=new T.Vector3(...from),d=new T.Vector3(...to).sub(a);const o=new T.ArrowHelper(d.clone().normalize(),a,d.length(),linear(color),.20,.09);group.add(o);return o};
 const label=(text,object,offset=[0,0,0])=>{labels.push({text,object,offset:new T.Vector3(...offset)});return object};
 const plate=(w,d,h,r,color,x=0,y=0,z=0)=>{const s=new T.Shape();s.moveTo(-w/2,-d/2);s.lineTo(w/2,-d/2);s.lineTo(w/2,d/2);s.lineTo(-w/2,d/2);s.closePath();const hole=new T.Path();hole.absarc(0,0,r,0,Math.PI*2,true);s.holes.push(hole);const o=add(new T.ExtrudeGeometry(s,{depth:h,bevelEnabled:false,curveSegments:32}),color,x,y+h/2,z);o.rotation.x=Math.PI/2;return o};
 function tool(x=0,y=2.4,z=0,o={}){const g=new T.Group();g.position.set(x,y,z);group.add(g);const radius=o.radius||.35,length=o.length||2.1,flutes=o.flutes||3,twist=o.twist??1.8;const shank=new T.Mesh(new T.CylinderGeometry(radius*.94,radius*.94,1.25,24),material(C.steel));shank.position.y=.625;g.add(shank);const body=new T.Group();g.add(body);
 if(o.pcd){const shaft=new T.Mesh(new T.CylinderGeometry(radius*.8,radius*.8,length,24),material(C.steel));shaft.position.y=-length/2;body.add(shaft);for(let i=0;i<2;i++){const tip=new T.Mesh(new T.BoxGeometry(radius*.35,length*.65,radius*.9),material(C.indigo));tip.position.set((i?1:-1)*radius*.8,-length*.6,0);body.add(tip)}}else{const v=[],cs=[],ix=[],seg=72,rings=36,ec=linear(C.indigo),mc=linear(C.steel);for(let a=0;a<=rings;a++)for(let b=0;b<=seg;b++){const y=-length*a/rings,theta=b/seg*Math.PI*2+y*twist,phase=(b/seg*flutes)%1;let r=radius*(.67+.33*Math.pow(Math.sin(Math.PI*phase),2));if(o.drill)r*=Math.min(1,(length+y)/(.35*length)+.025);v.push(Math.cos(theta)*r,y,Math.sin(theta)*r);const c=phase>.43&&phase<.59?ec:mc;cs.push(c.r,c.g,c.b);if(a<rings&&b<seg){const p=a*(seg+1)+b;ix.push(p,p+1,p+seg+1,p+1,p+seg+2,p+seg+1)}}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));geo.setAttribute('color',new T.Float32BufferAttribute(cs,3));geo.setIndex(ix);geo.computeVertexNormals();body.add(new T.Mesh(geo,material(C.paper,{vertexColors:true,side:T.DoubleSide})));if(!o.drill){const end=new T.Mesh(new T.CircleGeometry(radius,36),material(C.steel,{side:T.DoubleSide}));end.rotation.x=Math.PI/2;end.position.y=-length;body.add(end)}}
 let holder;if(o.holder!==false){holder=new T.Mesh(new T.CylinderGeometry(radius*1.65,radius*1.4,.72,24),material(C.navy));holder.position.y=1.45;g.add(holder)}if(o.ghost)g.traverse(m=>{if(m.material){m.material.wireframe=true;m.material.transparent=true;m.material.opacity=.45}});return {g,body,shank,holder,radius,length}}
 function wheel(x=0,y=1,z=0,r=1.1){const g=new T.Group();g.position.set(x,y,z);group.add(g);const d=new T.Mesh(new T.CylinderGeometry(r,r,.28,40),material(C.navy));d.rotation.x=Math.PI/2;g.add(d);const h=new T.Mesh(new T.CylinderGeometry(r*.22,r*.22,.34,24),material(C.silver));h.rotation.x=Math.PI/2;g.add(h);const s=new T.Mesh(new T.BoxGeometry(r*1.65,.055,.31),material(C.lavender));g.add(s);return g}
 function chips(origin=[0,1,0],direction=[1,1,.2],count=12,color=C.copper){const items=[],geo=new T.BoxGeometry(.065,.04,.13),mat=material(color);for(let i=0;i<count;i++){const m=new T.Mesh(geo,mat);group.add(m);items.push(m)}return t=>items.forEach((m,i)=>{const p=(cycle(t,2.3)+i/count)%1;m.position.set(origin[0]+direction[0]*p+Math.sin(i*5)*.12,origin[1]+direction[1]*p-.4*p*p,origin[2]+direction[2]*p+Math.cos(i*3)*.15);m.rotation.set(t+i,t*.8+i,i);m.scale.setScalar(Math.sin(Math.PI*p)*.8+.2)})}
 function card(x,y,z,color=C.paper){const p=box(1.25,1.55,.08,color,x,y,z);for(let i=0;i<4;i++)line([[x-.45,y+.4-i*.23,z+.05],[x+.32-(i%2)*.2,y+.4-i*.23,z+.05]],C.steel);return p}
 function pocket(x=0,y=0,z=0,color=C.steel){const g=new T.Group();g.position.set(x,y,z);group.add(g);for(const [w,h,d,a,b,c]of [[2.4,.22,1.8,0,-.2,0],[2.4,.55,.22,0,.15,-.79],[.22,.55,1.8,-1.09,.15,0],[.22,.55,1.8,1.09,.15,0],[2.4,.55,.22,0,.15,.79]]){const m=new T.Mesh(new T.BoxGeometry(w,h,d),material(color));m.position.set(a,b,c);g.add(m)}return g}
 function check(x,y,z,good=true){const a=line(good?[[x-.15,y,z],[x-.02,y-.13,z],[x+.28,y+.19,z]]:[[x-.15,y-.15,z],[x+.15,y+.15,z]],good?C.indigo:C.ruby);if(!good)line([[x-.15,y+.15,z],[x+.15,y-.15,z]],C.ruby);return a}
 function caliper(x,y,z,r=.45){const rail=box(1.7,.10,.13,C.navy,x,y+.6,z);const left=box(.09,.75,.14,C.indigo,x-r,y+.3,z),right=box(.09,.75,.14,C.indigo,x+r,y+.3,z);return {rail,left,right}}
 return {T,group,labels,material,add,box,cyl,ball,line,ring,arrow,label,plate,tool,wheel,chips,card,pocket,check,caliper};
}
function cuttingCell(k,x=0,z=0,opts={}){
 const p=k.pocket(x,0,z),tool=k.tool(x,2.0,z,{radius:.28,...opts});
 const contact=[x,.25,z],chip=k.chips(contact,[1.1,1.5,.5]);
 return {part:p,tool,animate(t){const a=cycle(t,8)*Math.PI*2;tool.g.position.x=x+Math.sin(a)*.75;tool.g.position.z=z+Math.cos(a)*.48;tool.g.rotation.y=t*2.6;contact[0]=tool.g.position.x+.12;contact[2]=tool.g.position.z;chip(t)}};
}
function wedge(k,x=0,z=0,kind='normal'){
 const s=new k.T.Shape();const pts=kind==='chip'?[[0,0],[.3,.12],[.20,.38],[.48,.28],[.85,.35],[.85,1.15],[.25,1.15]]:[[0,0],[.85,.3],[.85,1.15],[.25,1.15]];
 s.moveTo(...pts[0]);pts.slice(1).forEach(p=>s.lineTo(...p));s.closePath();
 const edge=k.add(new k.T.ExtrudeGeometry(s,{depth:.8,bevelEnabled:false}),C.navy,x,.27,z-.4);
 const p=k.box(2.8,.5,1.4,C.silver,x-.7,0,z);
 const curve=new k.T.CatmullRomCurve3([new k.T.Vector3(x,.3,z),new k.T.Vector3(x+.08,.8,z),new k.T.Vector3(x-.05,1.3,z),new k.T.Vector3(x-.55,1.45,z),new k.T.Vector3(x-.8,1.1,z)]);
 const chip=k.add(new k.T.TubeGeometry(curve,40,.06,6,false),C.copper);
 let damage=null;
 if(kind==='wear')damage=k.box(.4,.06,.85,C.ruby,x+.25,.35,z);
 if(kind==='buildup')damage=k.ball(.19,C.copper,x,.45,z);
 return {edge,part:p,chip,damage};
}
function pcbStack(k,x=0,z=0,options={}){
 const layers=[],n=options.stack?3:1;
 for(let board=0;board<n;board++)for(let i=0;i<5;i++){
 const y=-.3+board*.64+i*.11;const o=k.plate(3.3,2,.10,.24,i%2===0?C.copper:C.cream,x,y,z);layers.push(o);
 }
 if(options.stack){k.label('Entry sheet',k.plate(3.5,2.2,.06,.25,C.silver,x,1.8,z));k.label('Backing',k.plate(3.5,2.2,.18,.25,C.navy,x,-.57,z),[0,0,.8]);}
 const start=options.stack?3.55:3.2,length=options.stack?1.5:2.5,stroke=options.stack?2.62:1.25;
 const tool=k.tool(x,start,z,{drill:true,flutes:2,radius:.22,length,holder:!options.stack});
 if(options.stack){tool.shank.scale.y=.5;tool.shank.position.y=.3125;}
 return {layers,tool,animate:t=>{tool.g.position.y=start-triangle(t,7)*stroke;tool.g.rotation.y=t*3}};
}
function assembly(k,x=0,y=1,z=0,expanded=true){
 const body=k.box(1.6,.7,1.4,C.steel,x,y-.55,z),join=k.box(1.25,.05,1.05,C.copper,x,y-.12,z),back=k.box(1.25,.24,1.05,C.silver,x,y+.12,z),diamond=k.box(1.25,.11,1.05,C.indigo,x,y+.36,z);
 k.label('PCD layer',diamond,[0,.12,0]);k.label('Backing',back,[-.65,0,0]);k.label('Tool body',body,[.7,-.1,0]);
 return {body,join,back,diamond,animate(t){const gap=expanded?(0.2+triangle(t,8)*.55):.05;diamond.position.y=y+.36+gap*1.6;back.position.y=y+.12+gap*.7;join.position.y=y-.12+gap*.2}};
}
function makeScene(k,kind,step){
 const {T,group,box,cyl,ball,line,ring,arrow,label,plate,tool,wheel,chips,card,pocket,check,caliper}=k;
 if(kind==='system'){
  if(step===0){const w=wheel(-2.5,1.8,0,.85),a=tool(-1.65,2.35,0,{radius:.24,holder:false});const cell=cuttingCell(k,1.65);label('Making the tool',w,[-.2,1,0]);label('Using the tool',cell.tool.g,[.3,1.4,0]);arrow([-.4,1.3,0],[.45,1.3,0]);return t=>{w.rotation.z=t*3;a.g.rotation.y=t*.8;cell.animate(t)}}
  if(step===1){const cell=cuttingCell(k);const l=box(.45,.65,1.2,C.navy,-1.7,.2,0),r=box(.45,.65,1.2,C.navy,1.7,.2,0);label('Holder',cell.tool.holder,[.5,.3,0]);label('Part',cell.part,[-1,0,.7]);label('Clamps',r,[.4,.3,0]);return t=>cell.animate(t)}
  if(step===2){const p=plate(3.5,2,.5,.52,C.steel);const m=caliper(0,1.2,.45,.52);label('Check diameter',m.rail,[0,.4,0]);line([[-1.6,.28,0],[1.6,.28,0]],C.indigo,true);line([[0,.28,-.9],[0,.28,.9]],C.indigo,true);label('Target position',p,[1.2,.5,0]);return t=>{m.left.position.x=-.52-.22*triangle(t);m.right.position.x=.52+.22*triangle(t)}}
  const a=tool(-1.2,2.1,0,{ghost:true}),b=pocket(1.5,.1,0);label('Tool shape',a.g,[0,1.3,0]);label('Part feature',b,[0,.8,0]);return t=>{a.g.rotation.y=.3*Math.sin(t*.5)};
 }
 if(kind==='anatomy'){
  if(step===0){const a=tool(0,2.3,0,{radius:.5,length:2.4});label('Holder',a.holder,[.7,.3,0]);label('Shank',a.shank,[-.8,0,0]);label('Flutes / chip space',a.body,[.8,-1.4,0]);return t=>{a.g.rotation.y=t*.35}}
  if(step===1){const w=wedge(k);label('Chip',w.chip,[-.6,1.5,.1]);label('Cutting edge',w.edge,[-.3,0,.9]);label('Clearance gap',w.edge,[.7,-.05,.8]);arrow([1.2,.38,.75],[.4,.38,.75],C.indigo);return t=>{w.chip.scale.setScalar(1+Math.sin(t*1.8)*.025)}}
  if(step===2){const a=tool(-1.25,2.2,0,{radius:.48,flutes:2}),b=tool(1.25,2.2,0,{radius:.48,flutes:4});label('2 flutes · more room',a.g,[-.3,1.5,0]);label('4 flutes · less room',b.g,[.3,1.5,0]);return t=>{a.g.rotation.y=b.g.rotation.y=t*.4}}
  const a=tool(-1.5,2.9,0,{length:1.4}),b=tool(1.5,2.9,0,{length:2.8});label('Short reach',a.g,[-.4,1.5,0]);label('Long reach',b.g,[.4,1.5,0]);arrow([2.7,.5,0],[1.9,.5,0],C.ruby);return t=>{a.body.rotation.z=.025*Math.sin(t*2);b.body.rotation.z=.13*Math.sin(t*2)};
 }
 if(kind==='chips'){
  if(step===0){const w=wedge(k),move=chips([-.3,.6,0],[-1.2,1.6,.1]);label('Chip leaving',w.chip,[-.5,1.65,0]);label('Cutting edge',w.edge,[.2,.1,.8]);label('Fresh surface',w.part,[.7,.35,.7]);return t=>move(t)}
  if(step===1){const a=tool(0,2.4,0,{radius:.4});box(4.7,.5,1.4,C.silver,0,0,0);arrow([-2.2,1.4,.9],[2.2,1.4,.9]);const r=ring(.6,C.indigo,0,3.5,0);label('Spin',r,[.8,0,0]);label('Travel forward',a.g,[-1,0,.7]);return t=>{a.g.position.x=-1.7+3.4*cycle(t,7);a.g.rotation.y=t*3;r.position.x=a.g.position.x}}
  if(step===2){const disc=cyl(.9,.35,C.silver,0,1,0);box(2.2,.35,1.8,C.cream,1.25,1,0);const edge=ball(.11,C.indigo,.9,1.3,0),bite=box(.13,.15,.4,C.copper,1,1.3,0);label('Edge path',disc,[-1.2,.4,0]);label('Changing chip',bite,[.4,.5,.3]);ring(.9,C.indigo,0,1.2,0);return t=>{const a=t*.8;edge.position.set(Math.cos(a)*.9,1.3,Math.sin(a)*.9);bite.scale.z=.05+Math.max(0,Math.cos(a))*.95;bite.visible=Math.cos(a)>0}}
  const cell=cuttingCell(k);label('Tool load',cell.tool.g,[.8,0,0]);label('Part support',cell.part,[-1,.1,.8]);const a=arrow([.5,1.8,.5],[.5,3.9,.5],C.ruby),b=arrow([-1,.2,.5],[-1,-.7,.5],C.ruby);return t=>{cell.animate(t);a.visible=b.visible=Math.sin(t*2)>-.3};
 }
 if(kind==='materials'){
  if(step===0){const a=box(1.8,.7,1.8,C.silver,-1.35,.3,0),b=box(1.8,.7,1.8,C.steel,1.35,.3,0);label('Aluminium · condition A',a,[0,.8,0]);label('Aluminium · condition B',b,[0,.8,0]);const dot=ball(.12,C.indigo,-1.3,1.2,0);return t=>{dot.position.x=Math.sin(t*.7)*1.4;dot.position.y=1.25+.15*Math.sin(t)}}
  if(step===1){const a=wedge(k,-2.1),b=box(1.7,.5,1.5,C.steel,.6,0,0),c=pcbStack(k,2.5,0);c.tool.g.visible=false;c.layers.forEach(o=>o.scale.set(.48,1,.6));label('Curling chip',a.chip,[-1.9,1.6,0]);label('Fragments',b,[0,.75,0]);label('Layers',c.layers[4],[0,.6,0]);const f=chips([.6,.45,0],[.6,1,.3],9,C.steel);return t=>f(t)}
  if(step===2){const a=wedge(k,-1.7,0,'buildup'),b=wedge(k,1.3,0,'wear');label('Sticking to the edge',a.edge,[0,1.3,.3]);label('Wearing the edge',b.edge,[0,1.3,.3]);a.chip.visible=b.chip.visible=false;return t=>{a.damage.scale.setScalar(.65+.65*triangle(t,6));b.damage.scale.x=.6+.8*triangle(t,6)}}
  const board=pcbStack(k);label('Different layers',board.layers[2],[1.6,.4,0]);label('One drill',board.tool.g,[-.6,1.3,0]);return t=>board.animate(t);
 }
 if(kind==='toolmaterials'){
  if(step===0){const binder=box(2.8,1,1.8,C.lavender,0,.5,0,{transparent:true,opacity:.45});label('Binder',binder,[1.4,.6,0]);const grains=[];for(let i=0;i<24;i++)grains.push(ball(.16,C.steel,Math.sin(i*4.5)*1.15,.2+(i%3)*.3,Math.cos(i*3.2)*.65));label('Hard carbide grains',grains[9],[-.8,.7,0]);return t=>{group.rotation.y=Math.sin(t*.4)*.1}}
  if(step===1){const a=assembly(k);return t=>a.animate(t)}
  if(step===2){const a=tool(-2.3,2,0,{holder:false,radius:.32}),b=assembly(k,.2,.65,0,false);b.body.scale.setScalar(.65);b.diamond.scale.setScalar(.65);b.back.scale.setScalar(.65);b.join.scale.setScalar(.65);k.labels.length=0;const coat=cyl(.34,2.15,C.indigo,-2.3,.9,0,{transparent:true,opacity:.35});const diamond=k.add(new T.OctahedronGeometry(.65),C.lavender,2.3,.8,0);label('Thin diamond coating',coat,[-.2,1.7,0]);label('PCD segment',b.diamond,[0,.9,0]);label('Single crystal',diamond,[.3,1,0]);return t=>{a.g.rotation.y=t*.3;diamond.rotation.y=t*.3}}
  const a=assembly(k,-.7,.7,0,false),w=wheel(1.1,1.3,0,.8);return t=>{a.animate(t);w.rotation.z=t*2};
 }
 if(kind==='milling'){
  if(step===0){const c=cuttingCell(k);label('Wall',c.part,[-1.1,.65,-.65]);label('Floor',c.part,[.7,.1,.45]);label('Rotating cutter',c.tool.g,[.5,1.3,0]);return t=>c.animate(t)}
  if(step===1){box(2.8,.65,2,C.silver,1.3,.1,0);const a=tool(-.3,2.35,0,{radius:.55});const contact=box(.6,.7,1.1,C.indigo,0,.4,0,{transparent:true,opacity:.35});label('Width of contact',contact,[-.5,1,.8]);arrow([1.9,0,1.1],[1.9,.8,1.1]);label('Depth',a.g,[2,-1.4,1.1]);return t=>{a.g.position.x=-.45+.45*triangle(t);contact.scale.x=.2+.8*triangle(t);a.g.rotation.y=t*2}}
  if(step===2){for(let i=0;i<2;i++){const x=i?1.7:-1.7;const d=cyl(.8,.3,C.silver,x,.8,0);box(1.6,.3,1.3,C.cream,x+.8,.8,0);ring(.8,C.indigo,x,1,0);label(i?'Climb: thick → thin':'Conventional: thin → thick',d,[0,.75,0])}const a=box(.13,.12,.4,C.copper,-.9,1.1,0),b=box(.13,.12,.4,C.copper,2.5,1.1,0);return t=>{a.scale.z=.1+cycle(t,3)*1.5;b.scale.z=1.6-cycle(t,3)*1.5}}
  const p=box(4,.28,2.5,C.silver,0,0,0);for(let i=0;i<8;i++){const r=cyl(.12,3.8,C.lavender,0,.18,-1.05+i*.3);r.rotation.z=Math.PI/2}const a=tool(0,2.3,0,{radius:.32});const end=ball(.32,C.steel,0,.2,0);label('Rounded tool',a.g,[.5,1.3,0]);label('Ridges between passes',p,[1.5,.6,1]);return t=>{const u=cycle(t,8)*4;const row=Math.floor(u);a.g.position.x=(row%2?1:-1)*(1.6-(u%1)*3.2);a.g.position.z=-.8+row*.5;a.g.rotation.y=t*2;end.position.set(a.g.position.x,.2,a.g.position.z)};
 }
 if(kind==='holes'){
  if(step<2){const p=plate(3.4,2.3,.8,.35,C.silver,0,0,0);const a=tool(0,3.25,0,{radius:.33,drill:true,flutes:2,length:2.5});label('Drill',a.g,[.6,1.2,0]);label('Part',p,[1.4,.5,0]);const cs=chips([.1,.4,.1],[.35,2.7,.1],16,C.copper);if(step===1){arrow([-.9,2.8,0],[-.9,1,0]);label('Chips travel up',a.body,[-1,-.5,0])}return t=>{a.g.position.y=3.2-triangle(t,7)*.8;a.g.rotation.y=t*2.8;if(step===1)cs(t)}}
  if(step===2){const a=tool(-1.6,3,0,{radius:.26,drill:true,flutes:2}),b=tool(1.6,3,0,{radius:.31,flutes:6,twist:.2});plate(2.2,1.8,.7,.28,C.silver,-1.6,0,0);plate(2.2,1.8,.7,.32,C.silver,1.6,0,0);label('Drill · creates a hole',a.g,[-.2,1.3,0]);label('Reamer · finishes a hole',b.g,[.2,1.3,0]);return t=>{a.g.rotation.y=b.g.rotation.y=t*2;a.g.position.y=3-triangle(t,6)*.7;b.g.position.y=3-triangle(t+3,6)*.7}}
  const p=plate(3.3,2.2,.75,.48,C.steel);const c=caliper(0,1,.5,.48);label('Diameter',c.rail,[0,.5,0]);line([[-1.5,.42,0],[1.5,.42,0]],C.indigo,true);line([[0,.42,-1],[0,.42,1]],C.indigo,true);label('Position',p,[1.3,.6,0]);return t=>{c.left.position.x=-.48-.14*triangle(t);c.right.position.x=.48+.14*triangle(t)};
 }
 if(kind==='pcb'){
  if(step<2){const b=pcbStack(k,0,0,{stack:step===1});if(!step){label('Copper layers',b.layers[4],[1.5,.45,0]);label('Board material',b.layers[1],[-1.5,.3,0]);label('Drill',b.tool.g,[.5,1.4,0])}return t=>b.animate(t)}
  if(step===2){for(let i=0;i<7;i++){const y=-.35+i*.17;box(1.4,.16,1.5,i%2?C.cream:C.copper,-.95,y,0);box(1.4,.16,1.5,i%2?C.cream:C.copper,.95,y,0)}const smear=box(.065,.75,.8,C.ruby,.24,.25,.2);label('Possible residue',smear,[.6,.6,.4]);const wall=box(.02,1.2,1.5,C.indigo,-.25,.2,0,{transparent:true,opacity:.25});label('Hole wall',wall,[-.5,1,.4]);return t=>{smear.material.opacity=.55+.25*Math.sin(t);smear.material.transparent=true}}
  const b=box(3.3,.22,2,C.cream,0,0,0),a=tool(1.8,2.1,0,{radius:.21});label('Board outline',b,[0,.6,-1]);label('Router cuts with its side',a.g,[.5,1.4,0]);const dust=chips([1.6,.2,0],[1,1,.6],12,C.copper);return t=>{const u=cycle(t,9)*4;a.g.position.x=u<1?1.75:u<2?1.75-(u-1)*3.5:u<3?-1.75:-1.75+(u-3)*3.5;a.g.position.z=u<1?-1.1+u*2.2:u<2?1.1:u<3?1.1-(u-2)*2.2:-1.1;a.g.rotation.y=t*2.3;dust(t)};
 }
 if(kind==='failure'){
  if(step===0){const w=wedge(k,0,0,'chip');const mark=ring(.28,C.ruby,.23,.65,.45,0);label('Visible edge damage',mark,[.6,.5,0]);return t=>mark.scale.setScalar(1+Math.sin(t*2)*.12)}
  if(step===1){const a=wedge(k,-2.5,0,'wear'),b=wedge(k,0,0,'chip'),c=wedge(k,2.5,0,'buildup');[a,b,c].forEach(w=>{w.chip.visible=false;w.part.scale.x=.7});label('Wear',a.edge,[.3,1.5,0]);label('Chipping',b.edge,[.3,1.5,0]);label('Stuck material',c.edge,[.3,1.5,0]);return t=>{group.rotation.y=.05*Math.sin(t*.5)}}
  if(step===2){const a=tool(0,2.4,0,{radius:.45});ring(.47,C.indigo,0,.35,0);line([[0,-.2,0],[0,4.5,0]],C.copper,true);label('Holder',a.holder,[.6,.4,0]);label('Uneven edge path',a.body,[1,-1.8,0]);return t=>{a.body.position.x=Math.cos(t*2)*.16;a.body.position.z=Math.sin(t*2)*.16;a.g.rotation.y=t*2}}
  const a=cuttingCell(k,-1.7,0,{radius:.24}),b=cuttingCell(k,1.7,0,{radius:.24,twist:1.1});label('Baseline',a.tool.g,[-.3,1.3,0]);label('One planned change',b.tool.g,[.3,1.3,0]);return t=>{a.animate(t);b.animate(t)};
 }
 if(kind==='requirements'){
  if(step===0){const p=pocket();label('Customer part',p,[-1.3,.6,.3]);const r=box(1.4,.04,.9,C.indigo,0,-.05,0,{transparent:true,opacity:.35});label('Required pocket',r,[.5,.8,0]);return t=>{r.material.opacity=.2+.2*triangle(t)}}
  if(step===1){const a=box(1.2,.5,1.1,C.silver,-2.5,.4,0),b=pocket(0,.4,0),c=box(1.6,.4,1.1,C.navy,2.6,.4,0);b.scale.setScalar(.6);label('Exact material',a,[0,.8,0]);label('Required shape',b,[0,1,0]);label('Machine / setup',c,[0,.8,0]);const dot=ball(.12,C.indigo,-2,1.7,0);return t=>{dot.position.x=-2.5+5*cycle(t,5)}}
  if(step===2){const a=tool(0,2.1,0,{radius:.45,holder:false});const ghost=tool(0,2.1,0,{radius:.5,holder:false,ghost:true});const m=caliper(0,1.1,.7,.5);label('Drawing target',ghost.g,[-1,1.2,0]);label('Measured tool',a.g,[1,-.4,0]);return t=>{m.left.position.x=-.5-.15*triangle(t);m.right.position.x=.5+.15*triangle(t)}}
  if(step===3){const a=tool(-1.4,2,0,{radius:.35,holder:false,flutes:3}),b=tool(1.4,2,0,{radius:.42,holder:false,flutes:3});label('Revision A',a.g,[-.2,1.4,0]);label('Revision B',b.g,[.2,1.4,0]);line([[-2.4,-.15,0],[2.4,-.15,0]],C.copper,true);arrow([-.65,1.1,0],[.65,1.1,0]);return t=>{a.g.rotation.y=b.g.rotation.y=t*.35}}
  return workflow(k,['Request','Tool','Checked part'],'records');
 }
 if(kind==='grinding'){
  if(step===0){const b=cyl(.42,3.1,C.steel,0,1.45,0);const r=ring(.43,C.indigo,0,.0,0);label('Carbide blank',b,[.8,1.2,0]);label('Starting size',r,[-.7,.2,0]);return t=>{b.rotation.y=t*.5;r.scale.setScalar(1+.025*Math.sin(t))}}
  if(step===1||step===2){const blank=cyl(.38,2.8,C.steel,0,1.4,0);const finished=tool(0,2.8,0,{radius:.38,holder:false,length:2.8});finished.shank.visible=false;const w=wheel(-1.25,1.1,0,1);label('Grinding wheel',w,[-.6,.8,0]);label(step===2?'Rotation + wheel travel':'Small contact area',finished.g,[.9,-.3,0]);const dust=chips([-.25,1.1,0],[-.9,.5,.8],14,C.lavender);return t=>{const p=triangle(t,8);w.rotation.z=t*3;w.position.y=.3+p*2.2;blank.rotation.y=finished.g.rotation.y=t*.6;blank.material.transparent=true;blank.material.opacity=.15+.7*(1-p);finished.g.visible=p>.25;dust(t)}}
  if(step===3){const w=wheel(0,1.35,0,1.3),d=box(.48,.4,.7,C.copper,1.35,1.35,0);label('Wheel',w,[-1.2,1,0]);label('Conditioning tool',d,[.5,.55,0]);return t=>{w.rotation.z=t*2;d.position.y=1.35+Math.sin(t*.6)*.5}}
  return workflow(k,['Blank','Shaped tool','Inspection'],'manufacture');
 }
 if(kind==='pcdmake'){
  if(step===0){const a=assembly(k);return t=>a.animate(t)}
  if(step===1){const a=assembly(k,0,1,0,true);k.labels.length=0;label('PCD segment',a.diamond,[.6,.4,0]);label('Brazed joint',a.join,[-1,0,0]);label('Support pocket',a.body,[1,-.2,0]);return t=>a.animate(t)}
  if(step===2){const a=box(1.1,.3,1.1,C.indigo,-2.5,.35,0),b=box(1.1,.3,1.1,C.indigo,0,.35,0),c=box(1.1,.3,1.1,C.indigo,2.5,.35,0);const w=wheel(-2.9,1.2,0,.7);const electrode=box(.7,.5,.7,C.steel,0,1.4,0),beam=cyl(.035,1.5,C.ruby,2.5,1.3,0);const spark=ball(.13,C.copper,0,.75,0);label('Grinding contact',a,[0,-.7,.5]);label('EDM discharges',b,[0,-.7,.5]);label('Laser beam',c,[0,-.7,.5]);return t=>{w.rotation.z=t*2;spark.visible=Math.sin(t*14)>.1;beam.material.emissive.setHex(C.ruby);beam.material.emissiveIntensity=.35+.3*triangle(t,1.3);electrode.position.y=1.4+.08*Math.sin(t)}}
  if(step===3){const a=wedge(k,-1.5,0),b=wedge(k,1.5,0,'chip');a.chip.visible=b.chip.visible=false;label('Target edge',a.edge,[.2,1.4,0]);label('Chipped edge',b.edge,[.2,1.4,0]);const mark=ring(.27,C.ruby,1.7,.6,.45,0);return t=>mark.scale.setScalar(1+Math.sin(t*2)*.1)}
  const a=assembly(k,-1.4,.7,0,false),m=caliper(1.4,1,.3,.5),paper=card(2.5,1.1,-.7);k.labels.length=0;label('Finished supported tip',a.diamond,[-.2,.6,0]);label('Inspection',m.rail,[0,.5,0]);label('Matching record',paper,[.3,1,0]);arrow([-.5,.8,0],[.5,.8,0]);return t=>{a.animate(t);m.left.position.x=.9-.12*triangle(t)};
 }
 if(kind==='rollomatic'){
  if(step===0){const bed=box(4.6,.35,2.1,C.faint,0,-.4,0),a=tool(.8,2.5,0,{radius:.3}),w=wheel(-.45,1.2,0,.9);box(.8,.8,1.4,C.navy,.8,3.9,0);label('Tool blank / cutter',a.g,[1,.2,0]);label('Wheel',w,[-1,.7,0]);label('Machine support',bed,[-1,.3,.9]);return t=>{w.rotation.z=t*2;a.g.rotation.y=t*.45;w.position.y=1.1+.55*triangle(t)}}
  if(step===1){const a=tool(-1.6,2.1,0,{radius:.33,holder:false}),p=drawing(k,1.7,1.4,0);label('3D simulation',a.g,[-.4,1.4,0]);label('2D Tool Sketcher drawing',p,[.4,1.2,0]);arrow([-.6,1.2,0],[.5,1.2,0]);return t=>{a.g.rotation.y=t*.3}}
  if(step===2){const b=cyl(.28,2.5,C.steel,-2.6,1.3,0),a=tool(0,2.1,0,{radius:.28,holder:false}),p=assembly(k,2.5,.7,0,false);k.labels.length=0;label('Blank preparation',b,[-.1,1.5,0]);label('Tool grinding',a.g,[0,1.4,0]);label('Superhard-tool shaping',p.diamond,[.1,1.2,0]);return t=>{a.g.rotation.y=t*.35;p.animate(t)}}
  if(step===3){const a=tool(-1.5,2.1,0,{ghost:true,holder:false}),b=tool(1.1,2.1,0,{holder:false}),m=caliper(1.1,.6,.65,.35);label('Simulated shape',a.g,[-.3,1.5,0]);label('Measured result',b.g,[.5,1.5,0]);arrow([-.65,1.1,0],[.4,1.1,0]);return t=>{a.g.rotation.y=b.g.rotation.y=t*.35;m.right.position.x=1.45+.12*triangle(t)}}
  const a=cyl(.65,.35,C.silver,-1.9,1.1,0),b=cyl(.65,.35,C.silver,.1,1.1,0);const ac=cyl(.29,.4,C.indigo,-1.9,1.1,0),bc=cyl(.42,.4,C.indigo,.1,1.1,0);const p=drawing(k,2.2,1.3,0);label('Earlier core',a,[-.2,.6,0]);label('Changed core',b,[0,.6,0]);label('Updated record',p,[.3,1.2,0]);return t=>{bc.material.emissive.setHex(C.indigo);bc.material.emissiveIntensity=triangle(t)*.2};
 }
 if(kind==='quality'){
  if(step<2){const a=tool(0,2.5,0,{holder:false,radius:.42});const m=caliper(0,1.1,.65,.43);label('Tool feature',a.g,[-.8,1.3,0]);label(step?'Repeat the same check':'Measuring jaws',m.rail,[.9,.5,0]);if(step)box(1.3,.25,.9,C.navy,-2,.2,0);return t=>{const gap=.43+.33*(1-triangle(t,5));m.left.position.x=-gap;m.right.position.x=gap}}
  if(step===2){const vals=[.8,.9,.85,1,1.03,1.2,1.28,1.35],bars=[];for(let i=0;i<8;i++)bars.push(box(.38,vals[i],.65,C.indigo,-2.5+i*.7,vals[i]/2,0));const band=box(5.6,.45,.9,C.lavender,0,1.1,0,{transparent:true,opacity:.25});label('Target band',band,[2.3,.6,0]);label('Production order →',bars[3],[0,-.9,.6]);const scan=ball(.1,C.copper,-2.5,1.7,0);return t=>{scan.position.x=-2.5+4.9*cycle(t,7)}}
  if(step===3){const a=cuttingCell(k,-1.6,0,{radius:.24}),b=cuttingCell(k,1.6,0,{radius:.24});label('Baseline',a.tool.g,[-.25,1.3,0]);label('Candidate · same setup',b.tool.g,[.25,1.3,0]);return t=>{a.animate(t);b.animate(t)}}
  return workflow(k,['Inspected tool','Accepted part','Connected evidence'],'quality');
 }
 if(kind==='aiflow'){
  if(step===0)return workflow(k,['Feature','Material','Setup'],'inputs');
  if(step===1)return workflow(k,['Find a match','Check + trial','Engineer approves'],'approve');
  if(step===2){const a=drawing(k,-2.4,1.4,0),b=tool(0,2.2,0,{holder:false,radius:.29}),c=pocket(2.4,.2,0);c.scale.setScalar(.65);label('Drawing',a,[0,1.2,0]);label('Made tool',b.g,[0,1.4,0]);label('Trial result',c,[0,1.2,0]);const l1=line([[-1.7,1,0],[-.6,1,0]]),l2=line([[.6,1,0],[1.6,1,0]]);const dot=ball(.1,C.copper,0,1,0);return t=>{dot.position.x=-1.7+3.3*cycle(t,5)}}
  if(step===3){const a=tool(-1.4,2.1,0,{holder:false}),b=tool(1.4,2.1,0,{holder:false,ghost:true});label('Evidence available',a.g,[-.3,1.4,0]);label('Missing evidence',b.g,[.3,1.4,0]);check(-1.4,.5,.8);const dot=ball(.12,C.copper,1.4,.5,.8);return t=>{b.g.rotation.y=.3*Math.sin(t);dot.scale.setScalar(.8+.3*triangle(t))}}
  const a=tool(-1.6,2.2,0,{holder:false}),outline=tool(-1.6,2.2,0,{holder:false,ghost:true,radius:.4});const b=cuttingCell(k,1.6,0,{radius:.24});label('Rule / shape checks',a.g,[-.3,1.4,0]);label('Performance trial',b.tool.g,[.3,1.4,0]);return t=>b.animate(t);
 }
 if(kind==='team'){
  if(step===0)return workflow(k,['Design','Make','Check'],'waiting');
  if(step===1){const a=tool(-2.3,2.1,0,{holder:false,radius:.29}),b=tool(0,2.1,0,{holder:false,radius:.29,flutes:4}),p=card(2.3,1.5,0);label('Earlier tool',a.g,[0,1.3,0]);label('What changed?',b.g,[0,1.3,0]);label('Why? Evidence',p,[0,1.1,0]);arrow([-1.5,1.1,0],[-.6,1.1,0]);arrow([.7,1.1,0],[1.5,1.1,0]);return t=>{a.g.rotation.y=b.g.rotation.y=t*.3}}
  if(step===2){const blocks=[];for(let i=0;i<3;i++){const b=box(1.5,.3,1.2,i===2?C.indigo:C.lavender,-2+i*2,.2+i*.65,0);blocks.push(b);label(['Suggestion','Engineering check','Measured result'][i],b,[0,.6,0])}const dot=ball(.15,C.copper,-2,.7,0);return t=>{const p=cycle(t,6)*2;dot.position.set(-2+p*2,.7+p*.65,0)}}
  if(step===3)return workflow(k,['Designer','Manufacturing','Quality'],'records');
  const record=card(0,1.2,0),parts=[];for(let i=0;i<6;i++)parts.push(box(.45,.18,.6,C.silver,-2.6+(i%3)*.55,.1+Math.floor(i/3)*.3,0));label('Waiting jobs',parts[0],[0,1.1,0]);label('Shared record',record,[0,1.1,0]);const ready=box(1.2,.22,1,C.lavender,2.2,.1,0);label('Next job',ready,[0,.9,0]);const dot=ball(.13,C.indigo,-2,.8,0);return t=>{dot.position.x=-2+4.1*cycle(t,6);parts.forEach((m,i)=>{m.visible=i>=Math.floor(cycle(t,6)*6)})};
 }
 if(kind==='portfolio'){
  if(step===0){const a=tool(-2.3,2.1,0,{drill:true,flutes:2,holder:false,radius:.3}),b=tool(0,2.1,0,{holder:false,radius:.38}),c=tool(2.3,2.1,0,{pcd:true,holder:false,radius:.42});label('Drill family',a.g,[-.2,1.4,0]);label('Milling family',b.g,[0,1.4,0]);label('PCD-tipped example',c.g,[.2,1.4,0]);return t=>{a.g.rotation.y=b.g.rotation.y=c.g.rotation.y=t*.35}}
  if(step===1){const a=tool(-2.4,2.2,0,{ghost:true,holder:false,radius:.3}),b=tool(0,2.2,0,{holder:false,radius:.3}),c=pocket(2.4,.2,0);c.scale.setScalar(.65);label('Designed',a.g,[0,1.3,0]);label('Made',b.g,[0,1.3,0]);label('Used: part result',c,[0,1.1,0]);return t=>{a.g.rotation.y=b.g.rotation.y=t*.3}}
  if(step===2){const a=cuttingCell(k,-1.6,0,{radius:.24}),b=cuttingCell(k,1.6,0,{radius:.24,flutes:4});label('Baseline',a.tool.g,[-.3,1.4,0]);label('Planned change',b.tool.g,[.3,1.4,0]);return t=>{a.animate(t);b.animate(t)}}
  if(step===3){const a=box(3.1,.15,2.1,C.lavender,-1.8,.05,0,{transparent:true,opacity:.45}),b=box(2,.15,2.1,C.cream,2,.05,0);label('Related versions stay together',a,[0,1.9,0]);label('Separate test group',b,[0,1.9,0]);for(const [x,z]of [[-2.6,-.45],[-1.6,-.45],[-2.1,.6],[1.6,-.45],[2.4,.6]]){const t=tool(x,1.5,z,{holder:false,radius:.15,length:1});t.g.scale.setScalar(.75)}line([[.6,-.1,-1.5],[.6,2,-1.5],[.6,2,1.5]],C.navy,true);return t=>{a.material.opacity=.32+.1*triangle(t)}}
  const good=box(2.7,.15,2,C.lavender,-1.6,0,0),bad=box(1.9,.15,2,C.cream,1.9,0,0);label('Accepted parts',good,[0,1.2,0]);label('Rejected parts',bad,[0,1.2,0]);const pieces=[];for(let i=0;i<8;i++){const x=i<6?-2.4+(i%3)*.75:1.6+(i%2)*.6,z=i<6?-.5+Math.floor(i/3):0;const p=plate(.55,.55,.18,.12,i<6?C.indigo:C.ruby,x,.25,z);pieces.push(p)}return t=>pieces.forEach((p,i)=>{p.position.y=.25+(i===Math.floor(cycle(t,8)*8)?.12:0)});
 }
 return ()=>{};
}
function drawing(k,x,y,z){const p=k.box(1.55,2.5,.07,C.paper,x,y,z);k.line([[x-.20,y-1,z+.05],[x-.20,y+.8,z+.05],[x+.20,y+.8,z+.05],[x+.20,y-1,z+.05],[x-.20,y-1,z+.05]],C.indigo);for(let i=0;i<4;i++)k.line([[x-.2,y-.8+i*.3,z+.06],[x+.2,y-.6+i*.3,z+.06]],C.steel);k.line([[x-.5,y-1,z+.05],[x-.5,y+.8,z+.05]],C.copper);k.line([[x-.62,y-1,z+.05],[x-.4,y-1,z+.05]],C.copper);k.line([[x-.62,y+.8,z+.05],[x-.4,y+.8,z+.05]],C.copper);return p}
function workflow(k,names,mode){const positions=[-2.5,0,2.5],items=[];for(let i=0;i<3;i++){const x=positions[i],base=k.box(1.7,.15,1.6,i===2?C.lavender:C.faint,x,0,0);k.label(names[i],base,[0,2.8,0]);if((mode==='records'||mode==='approve')&&i===0)items.push(drawing(k,x,1.25,0));else if((mode==='manufacture'&&i===0)||(mode==='inputs'&&i===1))items.push(k.cyl(.3,2,C.steel,x,1,0));else if((mode==='quality'&&i===1)||(mode==='inputs'&&i===0))items.push(k.pocket(x,.3,0));else{const a=k.tool(x,1.7,0,{holder:false,radius:.25,length:1.5});a.g.scale.setScalar(.75);items.push(a.g)}if(i<2)k.arrow([x+.9,.6,0],[x+1.6,.6,0]);if(mode==='approve'&&i===2)k.check(x,.6,.9)}const marker=k.ball(.13,C.indigo,-2.5,2.1,0);return t=>{let p=cycle(t,8);if(mode==='waiting')p=p<.45?p*.65:p<.70?.2925:.2925+(p-.7)*2.3583;marker.position.x=-2.5+5*p;marker.position.y=2.1+Math.sin(p*Math.PI)*.2}}
function fallbackSVG(kind,step,title){
 const tool='<g fill="none" stroke="#64748d" stroke-width="4"><path d="M282 65h36v140h-36z" fill="#d8e1ec"/><path d="m282 132 36 28m-36-8 36 28m-36-8 36 28" stroke="#665efd"/><path d="M271 52h58v40h-58z" fill="#1c1e54"/></g>';
 const plate='<path d="m155 225 190-24 110 42-190 28z" fill="#d8e1ec" stroke="#64748d"/><path d="M155 225v34l110 46v-34m0 34 190-28v-34" fill="#a8c3de" stroke="#64748d"/>';
 const board=[0,1,2,3,4].map(i=>`<path d="m145 ${200+i*13} 205-25 105 35-205 28z" fill="${i%2?'#f5e9d4':'#c99d67'}" stroke="#fff"/>`).join('');
 const wheel='<circle cx="180" cy="165" r="62" fill="#1c1e54"/><circle cx="180" cy="165" r="17" fill="#d8e1ec"/><path d="M125 165h110" stroke="#b9b9f9" stroke-width="5"/>';
 const text=(x,y,s)=>`<text x="${x}" y="${y}" text-anchor="middle" fill="#0d253d" font-family="Inter,system-ui,sans-serif" font-size="15">${E(s)}</text>`;
 let content='';
 if(['aiflow','team','portfolio'].includes(kind)){const names=kind==='aiflow'?['Request','Check + trial','Approval']:kind==='team'?['Design','Make','Check']:['Related tools','Fair trial','Good parts'];content=[90,265,440].map((x,i)=>`<rect x="${x-45}" y="135" width="115" height="85" rx="12" fill="${i===2?'#b9b9f9':'#e7edf5'}" stroke="#a8c3de"/>${text(x+12,180,names[i])}${i<2?`<path d="M${x+80} 177h43l-9-7m9 7-9 7" stroke="#533afd" fill="none" stroke-width="3"/>`:''}`).join('');content+=text(300,270,'An idea map: information moves between people and checks.');}
 else if(kind==='chips'||(kind==='anatomy'&&step===1)){content='<path d="M100 225h370v50H100z" fill="#d8e1ec"/><path d="m300 225 115-50V90h-65z" fill="#1c1e54"/><path d="M300 222c25-35 42-71 3-91s-68 28-32 41" fill="none" stroke="#c99d67" stroke-width="13"/>'+text(225,110,'Chip leaves the edge')+text(425,105,'Tool')+text(180,307,'Material being cut');}
 else if(kind==='pcb'||kind==='materials'){content=board+tool+text(440,170,'Different layers')+text(180,310,'Entry → layers → supported exit');}
 else if(kind==='toolmaterials'||kind==='pcdmake'){content='<path d="m170 228 160-20 100 30-160 24z" fill="#9aadc3"/><path d="m170 197 160-20 100 30-160 24z" fill="#c99d67"/><path d="m170 164 160-20 100 30-160 24z" fill="#d8e1ec"/><path d="m170 131 160-20 100 30-160 24z" fill="#665efd"/>'+text(440,130,'PCD layer')+text(440,175,'Support')+text(440,225,'Tool body')+text(260,293,'Different layers have different jobs.');}
 else if(kind==='grinding'||(kind==='system'&&step===0)){content=wheel+tool+'<path d="M231 169h51" stroke="#c99d67" stroke-width="5"/>'+text(165,70,'Grinding wheel')+text(355,115,'Tool blank')+text(300,290,'Making a tool comes before using it to make a part.');}
 else if(kind==='rollomatic'){content='<g transform="translate(-100 0)">'+tool+'</g><rect x="360" y="70" width="135" height="190" fill="white" stroke="#a8c3de"/><path d="M411 99h30v120h-30zM405 235h45m-45 7v-14m45 14v-14M290 170h48l-10-7m10 7-10 7" stroke="#533afd" fill="none" stroke-width="3"/>'+text(205,300,'3D simulation')+text(430,300,'2D drawing');}
 else if(kind==='failure'){content=[110,270,430].map((x,i)=>`<path d="m${x} 215 80-25V120h-40z" fill="#1c1e54"/><circle cx="${x+12}" cy="203" r="15" fill="none" stroke="#ea2261" stroke-width="5"/>${text(x+40,265,['Wear','Chipping','Stuck material'][i])}`).join('');}
 else{content=plate+tool+(kind==='quality'||kind==='requirements'?'<path d="M240 160v85m120-85v85m-120-70h120" stroke="#533afd" fill="none" stroke-width="5"/>':'')+text(410,100,kind==='holes'?'Point and flutes':'Rotating cutter')+text(180,310,kind==='holes'?'Create, then check the hole':'Part and its supports');}
 return `<svg class="lv-fallback-diagram" viewBox="0 0 600 350" role="img" aria-label="${E(title)}: still teaching diagram"><title>${E(title)}</title>${content}</svg>`;
}
function disposeObjects(object){const geos=new Set(),mats=new Set();object?.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m))});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());}
function dispose(){if(!active)return;const a=active;active=null;a.dead=true;if(a.raf)cancelAnimationFrame(a.raf);a.removers.forEach(fn=>fn());a.observer?.disconnect();a.intersection?.disconnect();disposeObjects(a.scene);a.renderer?.dispose();a.renderer?.forceContextLoss?.();a.host.replaceChildren();}
function mount(host,module){
 dispose();if(!host||!module?.sections?.length)return;
 const def=DEFINITIONS[module.id];if(!def)return;
 const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const a={host,module,def,index:0,time:0,last:0,playing:!reduced,visible:true,dead:false,raf:0,removers:[],webgl:false,labels:[]};active=a;
 const conceptual=['aiflow','team','portfolio'].includes(def[0]);
 host.innerHTML=`<section class="lv-shell" aria-labelledby="lv-heading"><header class="lv-heading"><div><span class="eyebrow">SEE IT HAPPEN</span><h2 id="lv-heading">Watch the idea take shape.</h2><p>Every step has its own moving example. Read alongside it, or listen.</p></div><span class="lv-kind">${conceptual?'3D idea map':'Animated 3D'}</span></header><div class="lv-layout"><div class="lv-media"><div class="lv-stage"><div class="lv-canvas-host"></div><div class="lv-labels" aria-hidden="true"></div><span class="lv-drag-hint">Drag to turn the view</span></div><div class="lv-transport"><button type="button" class="button primary lv-listen">Listen &amp; watch</button><button class="lv-motion" type="button">${a.playing?'Pause motion':'Play motion'}</button><button class="lv-replay" type="button">Replay</button><button class="lv-reset" type="button">Reset view</button><span class="lv-motion-state" aria-live="polite">${reduced?'Motion paused for your preference':'Slow motion for learning'}</span></div></div><div class="lv-explanation"><span class="lv-step-count"></span><h3 class="lv-step-heading" tabindex="-1" aria-live="polite"></h3><div class="lv-reading"></div><p class="lv-watch"></p><div class="lv-example"><span class="eyebrow">PICTURE THIS</span><p></p></div><div class="lv-key-point"><span>Remember this</span><p class="lv-takeaway"></p></div><div class="lv-voice-actions"><button type="button" class="button lv-ask" data-voice-action="tutor">Ask about this</button><button type="button" class="text-button" data-voice-panel="listen">Listening options</button><button type="button" class="text-button lv-go-deeper">Go deeper · engineering detail ↓</button></div></div></div><nav class="lv-steps" aria-label="Choose an idea in this lesson">${module.sections.map((s,i)=>`<button type="button" class="lv-step" data-step="${i}" aria-pressed="${i===0}" aria-label="Idea ${i+1}: ${E(s.heading)}"><span>${String(i+1).padStart(2,'0')}</span><span class="lv-step-name">${E(s.heading)}</span></button>`).join('')}</nav><div class="lv-bottom"><button type="button" class="lv-previous" aria-label="Previous idea">← Previous idea</button><p class="lv-scope">${conceptual?'An idea map: moving shapes represent information and decisions.':'Sizes and motion are simplified to make the idea visible.'}</p><button type="button" class="lv-next" aria-label="Next idea">Next idea →</button></div></section>`;
 a.q=s=>host.querySelector(s);a.stage=a.q('.lv-stage');a.surface=a.q('.lv-canvas-host');
 const on=(target,type,fn,options)=>{target.addEventListener(type,fn,options);a.removers.push(()=>target.removeEventListener(type,fn,options));};
 const emit=(name)=>window.dispatchEvent(new CustomEvent(name,{detail:{lessonId:module.id,sectionIndex:a.index}}));
 const updatePlay=()=>{a.q('.lv-motion').textContent=a.playing?'Pause motion':'Play motion';a.q('.lv-motion').setAttribute('aria-pressed',String(a.playing));a.q('.lv-motion-state').textContent=a.webgl?(a.playing?'Slow motion for learning':'Motion paused'):'Still diagram on this device';};
 function labelPositions(){if(!a.renderer||!a.camera)return;const w=a.surface.clientWidth,h=a.surface.clientHeight;const occupied=[];a.labels.forEach(({info,node})=>{const p=info.offset.clone();info.object.localToWorld(p);p.project(a.camera);let x=(p.x+1)*w/2,y=(1-p.y)*h/2;node.hidden=p.z>1||p.z< -1;const width=Math.min(155,w*.5);x=clamp(x,width/2+8,w-width/2-8);y=clamp(y,20,h-35);for(const prev of occupied)if(Math.abs(x-prev[0])<width*.75&&Math.abs(y-prev[1])<28)y=clamp(prev[1]+30,20,h-35);occupied.push([x,y]);node.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-50%)`;});}
 function frame(now){a.raf=0;if(a.dead)return;if(a.host.isConnected===false){dispose();return;}const animated=a.playing&&a.visible&&document.visibilityState!=='hidden';if(animated&&a.last&&now-a.last<1000/30){a.raf=requestAnimationFrame(frame);return;}const delta=a.last?Math.min(.05,(now-a.last)/1000):0;a.last=now;if(animated)a.time+=delta;try{a.animate?.(a.time);a.renderer?.render(a.scene,a.camera);labelPositions()}catch(_){fallback();return}if(animated)a.raf=requestAnimationFrame(frame);}
 function draw(){if(!a.dead&&a.webgl&&!a.raf)a.raf=requestAnimationFrame(frame);}
 function fallback(){if(a.dead)return;a.webgl=false;a.playing=false;if(a.raf)cancelAnimationFrame(a.raf);a.raf=0;a.renderer?.dispose();a.renderer=null;a.q('.lv-labels').replaceChildren();a.surface.innerHTML=fallbackSVG(def[0],a.index,module.sections[a.index].heading);a.q('.lv-drag-hint').textContent='Still diagram · choose an idea below';a.q('.lv-motion').disabled=true;a.q('.lv-replay').disabled=true;a.q('.lv-reset').disabled=true;a.q('.lv-kind').textContent='Teaching diagram';updatePlay();}
 a.draw=draw;a.fallback=fallback;a.updatePlay=updatePlay;
 try{
  const T=window.THREE;if(!T?.WebGLRenderer)throw new Error('3D unavailable');a.T=T;
  a.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});a.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));a.renderer.outputEncoding=T.sRGBEncoding;
  a.renderer.domElement.setAttribute('aria-label','Interactive teaching model. Drag, or use arrow keys, to turn it.');a.renderer.domElement.setAttribute('role','img');a.renderer.domElement.tabIndex=0;a.surface.appendChild(a.renderer.domElement);
  a.scene=new T.Scene();a.scene.add(new T.HemisphereLight(0xffffff,0xb7c0d7,1.2));for(const [x,y,z,n]of [[6,8,7,.8],[-5,3,-3,.5]]){const l=new T.DirectionalLight(0xffffff,n);l.position.set(x,y,z);a.scene.add(l)}
  a.camera=new T.OrthographicCamera(-5,5,3.8,-3.8,.1,100);a.camera.position.set(7,6,9);a.camera.lookAt(0,1.4,0);
  a.orbit=new T.Group();a.scene.add(a.orbit);const floor=new T.GridHelper(10,20,C.faint,C.faint);floor.position.y=-.72;a.scene.add(floor);
  a.webgl=true;
  const resize=()=>{if(a.dead||!a.renderer)return;const w=Math.max(1,a.surface.clientWidth),h=Math.max(1,a.surface.clientHeight),aspect=w/h,half=Math.max(3.5,4.6/aspect);a.renderer.setSize(w,h);a.camera.left=-half*aspect;a.camera.right=half*aspect;a.camera.top=half;a.camera.bottom=-half;a.camera.updateProjectionMatrix();draw()};
  if(typeof ResizeObserver==='function'){a.observer=new ResizeObserver(resize);a.observer.observe(a.surface)}else on(window,'resize',resize);resize();
  let dragging=null;const canvas=a.renderer.domElement;
  on(canvas,'pointerdown',e=>{dragging={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId)});
  on(canvas,'pointermove',e=>{if(!dragging)return;a.orbit.rotation.y+=(e.clientX-dragging.x)*.008;a.orbit.rotation.x=clamp(a.orbit.rotation.x+(e.clientY-dragging.y)*.006,-.5,.5);dragging={x:e.clientX,y:e.clientY};draw()});
  on(canvas,'pointerup',()=>{dragging=null});on(canvas,'pointercancel',()=>{dragging=null});
  on(canvas,'keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')a.orbit.rotation.y-=.15;if(e.key==='ArrowRight')a.orbit.rotation.y+=.15;if(e.key==='ArrowUp')a.orbit.rotation.x=clamp(a.orbit.rotation.x-.1,-.5,.5);if(e.key==='ArrowDown')a.orbit.rotation.x=clamp(a.orbit.rotation.x+.1,-.5,.5);draw()});
  on(canvas,'webglcontextlost',e=>{e.preventDefault();fallback()});
 }catch(_){fallback()}
 if(typeof IntersectionObserver==='function'){a.intersection=new IntersectionObserver(entries=>{a.visible=entries[0]?.isIntersecting!==false;a.last=0;if(!a.visible&&a.raf){cancelAnimationFrame(a.raf);a.raf=0}else draw()},{threshold:.05});a.intersection.observe(a.stage)}
 on(document,'visibilitychange',()=>{a.last=0;if(document.visibilityState==='hidden'&&a.raf){cancelAnimationFrame(a.raf);a.raf=0}else draw()});
 on(a.q('.lv-motion'),'click',()=>{a.playing=!a.playing;a.last=0;updatePlay();draw()});
 on(a.q('.lv-replay'),'click',()=>{a.time=0;a.last=0;draw()});
 on(a.q('.lv-reset'),'click',()=>{a.orbit?.rotation.set(0,0,0);draw()});
 on(a.q('.lv-listen'),'click',()=>{if(a.webgl){a.playing=true;a.last=0;updatePlay();draw()}emit('academy:visual-listen')});
 const chooseStep=index=>{selectStep(index);emit('academy:visual-step');a.host.scrollIntoView?.({behavior:reduced?'instant':'smooth',block:'start'});a.q('.lv-step-heading').focus?.({preventScroll:true});};
 host.querySelectorAll('[data-step]').forEach(b=>on(b,'click',()=>chooseStep(Number(b.dataset.step))));
 on(a.q('.lv-previous'),'click',()=>chooseStep(a.index-1));on(a.q('.lv-next'),'click',()=>chooseStep(a.index+1));
 selectStep(0);updatePlay();
}
function selectStep(index){const a=active;if(!a||a.dead)return;index=Number(index);if(!Number.isFinite(index))return;index=clamp(Math.round(index),0,a.module.sections.length-1);if(a.initialized&&index===a.index)return;a.index=index;a.initialized=true;a.time=0;a.last=0;const section=a.module.sections[index],watch=a.def[1][index]||section.takeaway||section.body;
 a.q('.lv-step-count').textContent=`IDEA ${index+1} OF ${a.module.sections.length}`;a.q('.lv-step-heading').textContent=section.heading;a.q('.lv-reading').innerHTML=`<p>${E(section.body)}</p>${section.bullets?.length?`<ul>${section.bullets.map(item=>`<li>${E(item)}</li>`).join('')}</ul>`:''}`;a.q('.lv-example p').textContent=section.example||'';a.q('.lv-example').hidden=!section.example;a.q('.lv-watch').textContent=watch;a.q('.lv-takeaway').textContent=section.takeaway||a.module.takeaway||'Watch what changes, and connect it to the part you want to make.';
 a.q('.lv-previous').disabled=index===0;a.q('.lv-next').disabled=index===a.module.sections.length-1;a.host.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.step)===index)));
 a.q('.lv-ask').dataset.voiceSectionId=`${a.module.id}:section:${index}`;
 if(a.webgl){try{if(a.model){disposeObjects(a.model);a.orbit.remove(a.model)}a.model=new a.T.Group();a.orbit.add(a.model);const helpers=kit(a.T,a.model);a.animate=makeScene(helpers,a.def[0],index);a.q('.lv-labels').replaceChildren();a.labels=helpers.labels.slice(0,3).map(info=>{const node=document.createElement('span');node.className='lv-model-label';node.textContent=info.text;a.q('.lv-labels').appendChild(node);return {info,node}});a.orbit.rotation.set(0,0,0);a.animate(0);a.draw()}catch(_){a.fallback()}}else a.surface.innerHTML=fallbackSVG(a.def[0],index,section.heading);
}
function getState(){const a=active;if(!a)return null;return {lessonId:a.module.id,sectionIndex:a.index,sectionTitle:a.module.sections[a.index].heading,sceneDescription:a.def[1][a.index],motionPlaying:a.webgl&&a.playing&&a.visible&&document.visibilityState!=='hidden',webglAvailable:a.webgl,scope:['aiflow','team','portfolio'].includes(a.def[0])?'Conceptual 3D map of information and decisions':'Simplified, enlarged teaching motion, not a production simulation'};}
window.AcademyLessonVisuals={mount,dispose,selectStep,getState};
})();
