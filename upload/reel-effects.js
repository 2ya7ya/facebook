(function () {
  'use strict';

  const catalog = [
    ['none', 'None', 'Basic'],
    ['rgb-split', 'RGB Split', 'Glitch'],
    ['glitch', 'Glitch', 'Glitch'],
    ['vhs', 'VHS', 'Retro'],
    ['old-tv', 'Old TV', 'Retro'],
    ['scanlines', 'Scanlines', 'Retro'],
    ['pixelate', 'Pixelate', 'Digital'],
    ['posterize', 'Posterize', 'Digital'],
    ['edge-glow', 'Edge Glow', 'Digital'],
    ['thermal', 'Thermal', 'Digital'],
    ['mirror', 'Mirror', 'Distort'],
    ['split-screen', 'Split Screen', 'Distort'],
    ['kaleidoscope', 'Kaleidoscope', 'Distort'],
    ['fisheye', 'Fisheye', 'Distort'],
    ['ripple', 'Ripple', 'Motion'],
    ['wave', 'Wave', 'Motion'],
    ['zoom-pulse', 'Zoom Pulse', 'Motion'],
    ['shake', 'Shake', 'Motion'],
    ['strobe', 'Strobe', 'Motion'],
    ['ghost', 'Ghost', 'Motion'],
    ['tunnel', 'Tunnel', 'Creative'],
    ['bloom', 'Bloom', 'Light'],
    ['grain', 'Grain', 'Retro'],
    ['vignette', 'Vignette', 'Lens'],
    ['bokeh-blur', 'Bokeh Blur', 'Lens'],
    ['lens-flare', 'Lens Flare', 'Light'],
    ['motion-blur', 'Motion Blur', 'Motion'],
    ['bling', 'Bling', 'Light'],
    ['dynamic-distort', 'Dynamic Distort', 'Distort'],
    ['prism', 'Prism', 'Lens'],
    ['light-leak', 'Light Leak', 'Light'],
    ['datamosh', 'Datamosh', 'Glitch'],
    ['block-glitch', 'Block Glitch', 'Glitch'],
    ['digital-rain', 'Digital Rain', 'Digital'],
    ['color-trails', 'Color Trails', 'Motion'],
    ['echo-zoom', 'Echo Zoom', 'Motion'],
    ['radial-blur', 'Radial Blur', 'Motion'],
    ['swirl', 'Swirl', 'Distort'],
    ['stretch', 'Stretch', 'Distort'],
    ['liquid-glass', 'Liquid Glass', 'Creative'],
    ['flash-zoom', 'Flash Zoom', 'Motion'],
    ['dream-glow', 'Dream Glow', 'Light'],
    ['mini-zoom', 'Mini Zoom', 'Basic'],
    ['zoom-lens', 'Zoom Lens', 'Basic'],
    ['blur', 'Blur', 'Basic'],
    ['shaky-camera-move', 'Shaky Camera Move', 'Dynamic'],
    ['delay', 'Delay', 'Dynamic'],
    ['shake-2', 'Shake 2', 'Dynamic'],
    ['astral', 'Astral', 'Dynamic'],
    ['shake-1', 'Shake 1', 'Dynamic'],
    ['neon-dynamic', 'Neon', 'Dynamic'],
    ['bounce-camera', 'Bounce Camera', 'Dynamic'],
    ['trembling', 'Trembling', 'Dynamic'],
    ['black-flash', 'Black Flash', 'Dynamic'],
    ['shake-dynamic', 'Shake', 'Dynamic'],
    ['soul', 'Soul', 'Dynamic'],
    ['disco-count', 'Disco Count', 'Fancy'],
    ['2026-loading', '2026 Loading', 'Fancy'],
    ['lyric-cut', 'Lyric Cut', 'Fancy'],
    ['quick-speed', 'Quick Speed', 'Fancy'],
    ['particles', 'Particles', 'Fancy'],
    ['question-mark', 'Question Mark', 'Fancy'],
    ['energy', 'Energy', 'Fancy'],
    ['moon-off', 'Moon Off', 'Fancy'],
    ['shockwave', 'Shockwave', 'Fancy'],
    ['somethings-wrong', "Something's Wrong", 'Fancy'],
    ['small-body-big-head', 'Small Body Big Head', 'Face Effect'],
    ['goat-eyes', 'Goat Eyes', 'Face Effect'],
    ['halo', 'Halo', 'Face Effect'],
    ['facial-fisheye', 'Facial Fisheye', 'Face Effect'],
    ['half-face-whirl', 'Half Face Whirl', 'Face Effect'],
    ['laser-eyes', 'Laser Eyes', 'Face Effect'],
    ['shy', 'Shy', 'Face Effect'],
    ['feeling-hurt', 'Feeling Hurt', 'Face Effect'],
    ['face-mosaic', 'Face Mosaic', 'Face Effect'],
    ['laser', 'Laser', 'Face Effect']
  ].map(function (item, index) { return { id: item[0], name: item[1], category: item[2], mode: index }; });
  const modes = Object.fromEntries(catalog.map(function (effect) { return [effect.id, effect.mode]; }));

  const vertexSource = [
    'attribute vec2 a_position;',
    'varying vec2 v_uv;',
    'void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}'
  ].join('\n');
  const fragmentSource = [
    'precision mediump float;',
    'uniform sampler2D u_image; uniform vec2 u_resolution; uniform float u_time; uniform int u_mode; uniform vec4 u_face; uniform vec4 u_eyes;',
    'varying vec2 v_uv;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'vec4 tex(vec2 p){return texture2D(u_image,clamp(p,0.001,0.999));}',
    'void main(){',
    ' vec2 uv=v_uv; vec2 p=uv-.5; vec4 c=tex(uv); float t=u_time;',
    ' if(u_mode==1){float d=.012+.006*sin(t*3.0);c=vec4(tex(uv+vec2(d,0.)).r,tex(uv).g,tex(uv-vec2(d,0.)).b,1.);}',
    ' else if(u_mode==2){float row=floor(uv.y*34.);float gate=step(.78,hash(vec2(row,floor(t*8.))));float off=(hash(vec2(row,t))-.5)*.13*gate;vec2 q=uv+vec2(off,0.);c=vec4(tex(q+vec2(.009*gate,0.)).r,tex(q).g,tex(q-vec2(.009*gate,0.)).b,1.);}',
    ' else if(u_mode==3){float wob=sin(uv.y*80.+t*5.)*.003+sin(uv.y*13.+t*2.)*.006;c=tex(uv+vec2(wob,0.));float scan=.88+.12*sin(uv.y*u_resolution.y*1.25);float noise=(hash(uv*u_resolution.xy+floor(t*30.))-.5)*.12;c.rgb=c.rgb*scan+noise;c.r+=.025;c.b+=.035;}',
    ' else if(u_mode==4){p*=1.08;float r2=dot(p,p);uv=.5+p*(1.+r2*.22);c=tex(uv);float scan=.82+.18*sin(v_uv.y*u_resolution.y*1.35);float n=(hash(floor(v_uv*u_resolution.xy)+floor(t*24.))-.5)*.1;c.rgb=c.rgb*scan+n;c.rgb*=1.-smoothstep(.36,.72,dot(p,p));}',
    ' else if(u_mode==5){c.rgb*=.72+.28*sin(uv.y*u_resolution.y*1.55);}',
    ' else if(u_mode==6){vec2 size=vec2(28.,50.);uv=(floor(uv*size)+.5)/size;c=tex(uv);}',
    ' else if(u_mode==7){c.rgb=floor(c.rgb*5.)/5.;c.rgb=pow(c.rgb,vec3(.88));}',
    ' else if(u_mode==8){vec2 px=1./u_resolution;vec3 gx=tex(uv+vec2(px.x,0.)).rgb-tex(uv-vec2(px.x,0.)).rgb;vec3 gy=tex(uv+vec2(0.,px.y)).rgb-tex(uv-vec2(0.,px.y)).rgb;float e=length(gx)+length(gy);c.rgb=mix(c.rgb*.22,vec3(e*.3,e*1.4,e*2.2),.85);}',
    ' else if(u_mode==9){float l=dot(c.rgb,vec3(.299,.587,.114));c.rgb=clamp(vec3(1.5-abs(4.*l-3.),1.5-abs(4.*l-2.),1.5-abs(4.*l-1.)),0.,1.);}',
    ' else if(u_mode==10){uv.x=abs(uv.x-.5)+.5;c=tex(uv);}',
    ' else if(u_mode==11){uv=fract(uv*vec2(2.,2.));if(mod(floor(v_uv.x*2.)+floor(v_uv.y*2.),2.)>0.)uv.x=1.-uv.x;c=tex(uv);}',
    ' else if(u_mode==12){float a=atan(p.y,p.x);float r=length(p);float seg=3.14159265/3.;a=abs(mod(a,seg)-seg*.5);uv=.5+vec2(cos(a),sin(a))*r;c=tex(uv);}',
    ' else if(u_mode==13){float r=length(p);uv=.5+p*(1.-.72*r*r);c=tex(uv);c.rgb*=1.-smoothstep(.52,.72,r);}',
    ' else if(u_mode==14){float r=length(p);uv+=normalize(p+vec2(.0001))*sin(r*38.-t*7.)*.012;c=tex(uv);}',
    ' else if(u_mode==15){uv.x+=sin(uv.y*15.+t*4.)*.025;uv.y+=cos(uv.x*12.+t*3.)*.012;c=tex(uv);}',
    ' else if(u_mode==16){float z=1.+.12*sin(t*4.);uv=.5+p/z;c=tex(uv);}',
    ' else if(u_mode==17){vec2 j=vec2(hash(vec2(floor(t*18.),1.)),hash(vec2(floor(t*18.),2.)))-.5;uv+=j*.035;c=tex(uv);}',
    ' else if(u_mode==18){float f=.42+.58*step(.48,sin(t*13.));c.rgb*=f;}',
    ' else if(u_mode==19){vec2 o=vec2(.018*sin(t*2.4),.012*cos(t*1.7));c=mix(c,tex(uv+o),.42);c=mix(c,tex(uv-o*1.8),.2);}',
    ' else if(u_mode==20){float a=atan(p.y,p.x)+t*.28;float r=length(p);uv=vec2(fract(a/6.28318*2.+r*1.8),fract(r*2.-t*.12));c=tex(uv);}',
    ' else if(u_mode==21){vec2 q=2.5/u_resolution;vec3 b=(tex(uv+vec2(q.x,0.)).rgb+tex(uv-vec2(q.x,0.)).rgb+tex(uv+vec2(0.,q.y)).rgb+tex(uv-vec2(0.,q.y)).rgb)*.25;c.rgb+=max(b-vec3(.52),0.)*1.35;}',
    ' else if(u_mode==22){float n=hash(floor(uv*u_resolution.xy)+floor(t*24.));c.rgb+=(n-.5)*.22;c.rgb=mix(c.rgb,vec3(dot(c.rgb,vec3(.299,.587,.114))),.08);}',
    ' else if(u_mode==23){float v=1.-smoothstep(.18,.72,dot(p*vec2(.82,1.12),p*vec2(.82,1.12))*1.8);c.rgb*=.48+.52*v;}',
    ' else if(u_mode==24){vec2 q=5./u_resolution;c=(tex(uv)*4.+tex(uv+vec2(q.x,0.))+tex(uv-vec2(q.x,0.))+tex(uv+vec2(0.,q.y))+tex(uv-vec2(0.,q.y))+tex(uv+q)+tex(uv-q)+tex(uv+vec2(q.x,-q.y))+tex(uv+vec2(-q.x,q.y)))/12.;}',
    ' else if(u_mode==25){vec2 f=uv-vec2(.78+.08*sin(t*.7),.72+.05*cos(t*.9));float glow=.055/(dot(f,f)+.015);vec2 g=uv-vec2(.39,.38);float orb=.018/(dot(g,g)+.025);c.rgb+=vec3(1.,.62,.25)*glow+vec3(.25,.5,1.)*orb;}',
    ' else if(u_mode==26){vec2 d=vec2(.014,.008)*sin(t*2.2);c=(tex(uv-d*3.)+tex(uv-d*2.)+tex(uv-d)+tex(uv)*2.+tex(uv+d)+tex(uv+d*2.)+tex(uv+d*3.))/8.;}',
    ' else if(u_mode==27){vec2 cell=floor(uv*vec2(12.,20.));vec2 local=fract(uv*vec2(12.,20.))-.5;float seed=hash(cell);float tw=step(.82,seed)*(.5+.5*sin(t*7.+seed*30.));float star=max(0.,.045/(abs(local.x)+.025)+.045/(abs(local.y)+.025)-2.1)*tw;float lum=dot(c.rgb,vec3(.299,.587,.114));c.rgb+=vec3(1.,.9,.65)*star*step(.45,lum);}',
    ' else if(u_mode==28){float r=length(p);float a=atan(p.y,p.x)+.12*sin(t*1.7+r*9.);float rr=r*(1.+.35*r*r)+.018*sin(t*3.+r*28.);uv=.5+vec2(cos(a),sin(a))*rr;c=tex(uv);}',
    ' else if(u_mode==29){float r=length(p);vec2 d=normalize(p+vec2(.0001))*(.008+.025*r);c=vec4(tex(uv+d).r,tex(uv).g,tex(uv-d).b,1.);}',
    ' else if(u_mode==30){vec2 f=uv-vec2(-.08+.12*sin(t*.45),.68+.1*cos(t*.6));float leak=smoothstep(.72,.02,length(f));vec2 f2=uv-vec2(1.08,.25+.12*sin(t*.5));float leak2=smoothstep(.62,.03,length(f2));c.rgb=1.-(1.-c.rgb)*(1.-vec3(1.,.22,.04)*leak*.8)*(1.-vec3(.45,.08,1.)*leak2*.55);}',
    ' else if(u_mode==31){vec2 grid=vec2(16.,28.);vec2 id=floor(uv*grid);float gate=step(.72,hash(vec2(id.y,floor(t*5.))));vec2 q=uv;q.x+=gate*(hash(id+floor(t*4.))-.5)*.18;q.y+=gate*.015;c=tex(q);c.gb=mix(c.gb,tex(q+vec2(.018,0.)).gb,gate*.8);}',
    ' else if(u_mode==32){vec2 g=vec2(9.,16.);vec2 id=floor(uv*g);float pulse=step(.68,hash(id+floor(t*9.)));vec2 q=uv+vec2((hash(id)-.5)*.09*pulse,(hash(id.yx)-.5)*.045*pulse);c=tex(q);c.rgb=mix(c.rgb,c.brg,pulse*.38);}',
    ' else if(u_mode==33){float col=floor(uv.x*34.);float speed=.25+hash(vec2(col,2.))*.8;float trail=fract(uv.y+t*speed+hash(vec2(col,1.)));float rain=smoothstep(.72,1.,trail)*step(.7,hash(vec2(col,floor((uv.y+t*speed)*22.))));float lum=dot(c.rgb,vec3(.299,.587,.114));c.rgb=mix(c.rgb,vec3(.05,lum*1.25+.2,.18),.42);c.rgb+=vec3(.05,1.,.3)*rain*.6;}',
    ' else if(u_mode==34){vec2 d=vec2(.012+.009*sin(t*3.),.004);vec3 a=tex(uv-d*3.).rgb;vec3 b=tex(uv-d*2.).rgb;vec3 e=tex(uv-d).rgb;c.rgb=vec3(a.r,b.g,e.b)*.7+c.rgb*.3;}',
    ' else if(u_mode==35){float z=.025+.018*sin(t*3.);vec4 a=tex(.5+p*(1.-z));vec4 b=tex(.5+p*(1.-z*2.));vec4 d=tex(.5+p*(1.-z*3.));c=c*.48+a*.25+b*.17+d*.1;}',
    ' else if(u_mode==36){float k=.018*(.5+.5*sin(t*2.));c=(tex(uv)+tex(.5+p*(1.-k))+tex(.5+p*(1.-k*2.))+tex(.5+p*(1.-k*3.))+tex(.5+p*(1.-k*4.)))/5.;}',
    ' else if(u_mode==37){float r=length(p);float a=atan(p.y,p.x)+(1.-smoothstep(0.,.7,r))*.85*sin(t*.9);uv=.5+vec2(cos(a),sin(a))*r;c=tex(uv);}',
    ' else if(u_mode==38){float s=.13*sin(t*3.2);uv=.5+vec2(p.x/(1.+s),p.y*(1.+s*.7));c=tex(uv);}',
    ' else if(u_mode==39){vec2 cell=floor(uv*vec2(10.,18.));vec2 n=vec2(hash(cell+floor(t*.8)),hash(cell.yx+floor(t*.8)))-.5;vec2 q=uv+n*.018;c=tex(q);float edge=abs(fract(uv.x*10.)-.5)+abs(fract(uv.y*18.)-.5);c.rgb+=smoothstep(.82,.96,edge)*.08;}',
    ' else if(u_mode==40){float phase=fract(t*1.6);float flash=1.-smoothstep(0.,.13,phase);float z=1.+.22*flash;uv=.5+p/z;c=tex(uv);c.rgb+=flash*.7;}',
    ' else if(u_mode==41){vec2 q=3.5/u_resolution;vec3 b=(tex(uv+q).rgb+tex(uv-q).rgb+tex(uv+vec2(q.x,-q.y)).rgb+tex(uv+vec2(-q.x,q.y)).rgb)*.25;c.rgb=mix(c.rgb,b,.3)+max(b-.55,0.)*.75;c.rgb+=vec3(.06,.025,.09);}',
    ' else if(u_mode==42){float ph=fract(t*1.8);float z=1.+.075*sin(ph*6.28318);uv=.5+p/z;c=tex(uv);}',
    ' else if(u_mode==43){vec2 lc=vec2(.5+.18*sin(t*.7),.52+.12*cos(t*.9));vec2 lp=uv-lc;float inside=1.-step(.23,length(lp));vec2 q=lc+lp/(1.+.7*inside);c=mix(c,tex(q),inside);c.rgb+=vec3(.12)*smoothstep(.012,0.,abs(length(lp)-.23));}',
    ' else if(u_mode==44){vec2 q=7./u_resolution;c=(tex(uv)*4.+tex(uv+vec2(q.x,0.))+tex(uv-vec2(q.x,0.))+tex(uv+vec2(0.,q.y))+tex(uv-vec2(0.,q.y))+tex(uv+q)+tex(uv-q)+tex(uv+vec2(q.x,-q.y))+tex(uv+vec2(-q.x,q.y)))/12.;}',
    ' else if(u_mode==45){vec2 j=vec2(hash(vec2(floor(t*9.),3.)),hash(vec2(floor(t*9.),7.)))-.5;float a=(hash(vec2(floor(t*9.),11.))-.5)*.055;mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a));uv=.5+r*p+j*.05;c=tex(uv);}',
    ' else if(u_mode==46){vec2 d=vec2(.018*sin(t*1.6),.012*cos(t*1.3));c=tex(uv)*.48+tex(uv-d)*.28+tex(uv-d*2.)*.16+tex(uv-d*3.)*.08;}',
    ' else if(u_mode==47){float k=floor(t*14.);vec2 j=(vec2(hash(vec2(k,2.)),hash(vec2(k,8.)))-.5)*.085;uv+=j;c=tex(uv);}',
    ' else if(u_mode==48){float z=.035+.014*sin(t*2.);vec2 q1=.5+p*(1.-z);vec2 q2=.5+p*(1.-z*2.);c=vec4(tex(q1).r,tex(uv).g,tex(q2).b,1.);c.rgb=mix(c.rgb,tex(q2).rgb,.22);}',
    ' else if(u_mode==49){vec2 j=vec2(sin(t*15.),cos(t*17.))*.012;uv+=j;c=tex(uv);}',
    ' else if(u_mode==50){vec2 px=1.5/u_resolution;vec3 gx=tex(uv+vec2(px.x,0.)).rgb-tex(uv-vec2(px.x,0.)).rgb;vec3 gy=tex(uv+vec2(0.,px.y)).rgb-tex(uv-vec2(0.,px.y)).rgb;float e=length(gx)+length(gy);vec3 neon=.5+.5*cos(vec3(0.,2.,4.)+t+uv.xyx*5.);c.rgb=c.rgb*.3+neon*e*3.;}',
    ' else if(u_mode==51){float b=abs(sin(t*3.2));float z=1.+.1*b;uv=.5+vec2(p.x,p.y+.035*b)/z;c=tex(uv);}',
    ' else if(u_mode==52){vec2 j=vec2(sin(t*38.)+sin(t*61.),cos(t*43.)+cos(t*57.))*.006;uv+=j;c=tex(uv);}',
    ' else if(u_mode==53){float f=step(.2,fract(t*1.7));c.rgb*=f;}',
    ' else if(u_mode==54){float k=floor(t*11.);vec2 j=(vec2(hash(vec2(k,5.)),hash(vec2(k,9.)))-.5)*.045;uv+=j;c=tex(uv);}',
    ' else if(u_mode==55){float z=.06*fract(t*.9);vec4 ghost=tex(.5+p*(1.-z));c=mix(c,ghost,.42*(1.-fract(t*.9)));c.rgb+=vec3(.06,.02,.12);}',
    ' else if(u_mode==56){float beat=step(.45,sin(t*6.28318));vec3 disco=.5+.5*cos(vec3(0.,2.1,4.2)+floor(t)*1.7+uv.y*5.);c.rgb=mix(c.rgb,disco*.8+c.rgb*.35,.48*beat);float ring=smoothstep(.018,0.,abs(length(p)-(.12+.05*mod(floor(t),3.))));c.rgb+=ring;}',
    ' else if(u_mode==57){float ang=atan(p.y,p.x);float rr=length(p);float spin=smoothstep(.025,0.,abs(rr-.18))*step(0.,sin(ang*10.-t*5.));c.rgb*=.72;c.rgb+=vec3(.2,.8,1.)*spin;float bar=smoothstep(.018,0.,abs(p.y+.27))*step(abs(p.x),.28);c.rgb+=vec3(.95)*bar;}',
    ' else if(u_mode==58){float cut=step(.5,fract(t*2.));float band=step(.42,fract(uv.y*9.+t*2.));c.rgb=mix(c.rgb,c.rgb*vec3(1.2,.45,.85),cut*band*.48);}',
    ' else if(u_mode==59){float ph=fract(t*2.4);float z=1.+.22*(1.-ph);uv=.5+p/z;c=tex(uv);c.rgb+=vec3(.35)*(1.-smoothstep(0.,.12,ph));}',
    ' else if(u_mode==60){vec2 grid=vec2(16.,28.);vec2 id=floor(uv*grid);vec2 q=fract(uv*grid)-.5;float seed=hash(id);float y=fract(q.y+t*(.3+seed));float dotp=smoothstep(.13,0.,length(vec2(q.x,y-.5)))*step(.62,seed);c.rgb+=dotp*(.5+.5*cos(vec3(0.,2.,4.)+seed*8.+t));}',
    ' else if(u_mode==61){vec2 q=p*3.;float ring=smoothstep(.12,.08,abs(length(q-vec2(0.,.16))-.42))*step(-.05,q.y);float stem=smoothstep(.08,.03,abs(q.x))*step(-.25,q.y)*step(q.y,.12);float dotq=smoothstep(.09,.035,length(q-vec2(0.,-.38)));c.rgb=mix(c.rgb,vec3(1.,.2,.65),clamp(ring+stem+dotq,0.,1.));}',
    ' else if(u_mode==62){float bolt=smoothstep(.035,0.,abs(p.x-.12*sin(p.y*34.+t*6.)-.035*sin(p.y*71.)))*step(abs(p.y),.48);c.rgb+=vec3(.2,.65,1.)*bolt*2.;c.rgb*=.82+.18*sin((uv.x+uv.y)*35.-t*7.);}',
    ' else if(u_mode==63){vec2 m=p-vec2(.18,.08);float moon=smoothstep(.27,.24,length(m))-smoothstep(.22,.19,length(m-vec2(.09,.04)));float off=step(.5,fract(t*.55));c.rgb=mix(c.rgb,vec3(.04,.05,.12),moon*off);c.rgb+=vec3(.8,.86,1.)*moon*(1.-off);}',
    ' else if(u_mode==64){float rr=length(p);float wave=smoothstep(.025,0.,abs(rr-fract(t*.65)*.72));uv+=normalize(p+vec2(.0001))*wave*.045;c=tex(uv);c.rgb+=vec3(.28,.65,1.)*wave;}',
    ' else if(u_mode==65){float row=floor(uv.y*23.);float gate=step(.55,hash(vec2(row,floor(t*7.))));uv.x+=(hash(vec2(row,t))-.5)*.15*gate;c=tex(uv);c.rgb=1.-c.bgr;c.rgb=mix(c.rgb,tex(v_uv).rgb,.35);}',
    ' else if(u_mode==66){vec2 fs=max(u_face.zw,vec2(.001));vec2 hc=u_face.xy+vec2(0.,fs.y*.14);vec2 fp=(uv-hc)/fs;float head=1.-smoothstep(.76,1.08,length(fp*vec2(.82,.72)));float body=step(uv.y,u_face.y-fs.y*.38);vec2 qb=vec2(.5+(uv.x-.5)*1.38,uv.y);vec2 qh=hc+(uv-hc)/vec2(1.82,1.92);vec2 q=mix(uv,qb,body*.82);q=mix(q,qh,head);c=tex(q);}',
    ' else if(u_mode==67){vec2 es=max(u_face.zw*vec2(.13,.075),vec2(.002));vec2 ep1=(uv-u_eyes.xy)/es;vec2 ep2=(uv-u_eyes.zw)/es;float e1=smoothstep(1.,.72,length(ep1));float e2=smoothstep(1.,.72,length(ep2));float pupil1=smoothstep(.2,.08,abs(ep1.y))*step(abs(ep1.x),.8);float pupil2=smoothstep(.2,.08,abs(ep2.y))*step(abs(ep2.x),.8);c.rgb=mix(c.rgb,vec3(.95,.85,.22),max(e1,e2));c.rgb=mix(c.rgb,vec3(.02),max(pupil1,pupil2));}',
    ' else if(u_mode==68){vec2 hp=(uv-(u_face.xy+vec2(0.,u_face.w*.64)))/vec2(max(u_face.z,.01),max(u_face.w,.01));float halo=smoothstep(.045,.018,abs(length(hp*vec2(1.,2.8))-.46));c.rgb+=vec3(1.,.78,.18)*halo*1.6;}',
    ' else if(u_mode==69){vec2 fp=(uv-u_face.xy)/max(u_face.zw,vec2(.001));float r=length(fp);float mask=1.-smoothstep(.45,.56,r);vec2 q=u_face.xy+(uv-u_face.xy)*(1.-.62*mask*(1.-r));c=mix(c,tex(q),mask);}',
    ' else if(u_mode==70){vec2 fs=max(u_face.zw,vec2(.001));vec2 fp=(uv-u_face.xy)/fs;float r=length(fp);float side=step(0.,fp.x);float mask=side*(1.-smoothstep(.48,.64,r));float twist=5.8*pow(max(0.,1.-r/.64),2.);float a=atan(fp.y,fp.x)+twist;vec2 q=u_face.xy+vec2(cos(a),sin(a))*r*fs;c=mix(c,tex(q),mask);}',
    ' else if(u_mode==71){vec2 le=u_eyes.xy;vec2 re=u_eyes.zw;if(le.x>re.x){vec2 tmp=le;le=re;re=tmp;}float ldx=max(0.,le.x-uv.x);float rdx=max(0.,uv.x-re.x);float lw=.018+ldx*.22;float rw=.018+rdx*.22;float leftBeam=(1.-smoothstep(lw-.012,lw,abs(uv.y-le.y+ldx*.05)))*step(uv.x,le.x);float rightBeam=(1.-smoothstep(rw-.012,rw,abs(uv.y-re.y-rdx*.05)))*step(re.x,uv.x);float beam=max(leftBeam,rightBeam);float leftCore=(1.-smoothstep(.006,.014,abs(uv.y-le.y+ldx*.05)))*step(uv.x,le.x);float rightCore=(1.-smoothstep(.006,.014,abs(uv.y-re.y-rdx*.05)))*step(re.x,uv.x);c.rgb=mix(c.rgb,vec3(1.,.03,.01),beam*.58);c.rgb+=vec3(1.,.28,.12)*max(leftCore,rightCore)*.8;}',
    ' else if(u_mode==72){vec2 fp=(uv-u_face.xy)/max(u_face.zw,vec2(.001));float cheek1=smoothstep(.14,.02,length((fp-vec2(-.23,-.08))*vec2(1.,2.)));float cheek2=smoothstep(.14,.02,length((fp-vec2(.23,-.08))*vec2(1.,2.)));c.rgb=mix(c.rgb,vec3(1.,.18,.42),max(cheek1,cheek2)*.55);}',
    ' else if(u_mode==73){float tw=max(.004,u_face.z*.018);float len=max(.06,u_face.w*.31);float range1=step(u_eyes.y-len,uv.y)*step(uv.y,u_eyes.y-.018);float range2=step(u_eyes.w-len,uv.y)*step(uv.y,u_eyes.w-.018);float outer1=(1.-smoothstep(tw,tw*2.5,abs(uv.x-u_eyes.x)))*range1;float outer2=(1.-smoothstep(tw,tw*2.5,abs(uv.x-u_eyes.z)))*range2;float core1=(1.-smoothstep(tw*.28,tw*.8,abs(uv.x-u_eyes.x)))*range1;float core2=(1.-smoothstep(tw*.28,tw*.8,abs(uv.x-u_eyes.z)))*range2;float tears=max(outer1,outer2);float cores=max(core1,core2);c.rgb=mix(c.rgb,vec3(.05,.62,1.),tears*.85);c.rgb=mix(c.rgb,vec3(1.),cores*.92);}',
    ' else if(u_mode==74){vec2 fp=(uv-u_face.xy)/max(u_face.zw,vec2(.001));float mask=step(abs(fp.x),.5)*step(abs(fp.y),.58);vec2 size=vec2(24.,34.);vec2 q=(floor(uv*size)+.5)/size;c=mix(c,tex(q),mask);}',
    ' else if(u_mode==75){vec2 fp=(uv-u_face.xy)/max(u_face.zw,vec2(.001));float beam=smoothstep(.06,.015,abs(fp.y-.08-.1*sin(fp.x*18.+t*7.)))*step(.12,abs(fp.x));c.rgb+=vec3(.1,.5,1.)*beam*1.7;float scan=smoothstep(.035,.008,abs(fract(uv.y*3.-t*.7)-.5));c.rgb+=vec3(.75,.05,1.)*scan*.45;}',
    ' gl_FragColor=vec4(clamp(c.rgb,0.,1.),1.);',
    '}'
  ].join('\n');

  function shader(gl, type, source) {
    const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item) || 'Effect shader failed.');
    return item;
  }
  function createRenderer(canvas, options) {
    options = options || {};
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Effect program failed.');
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const modeLocation = gl.getUniformLocation(program, 'u_mode');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const faceLocation = gl.getUniformLocation(program, 'u_face');
    const eyesLocation = gl.getUniformLocation(program, 'u_eyes');
    let face = [.5, .58, .38, .48];
    let eyes = [.43, .62, .57, .62];
    let faceDetector = null, faceMesh = null, faceMeshFailed = false, faceDetectionBusy = false, lastFaceDetection = 0;
    try { if ('FaceDetector' in window) faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); } catch (_error) { faceDetector = null; }
    function smoothValues(current, next) { return current.map(function (value, index) { return value * .58 + next[index] * .42; }); }
    function ensureFaceMesh() {
      if (faceMesh || faceMeshFailed || !window.FaceMesh) return faceMesh;
      try {
        faceMesh = new window.FaceMesh({ locateFile: function (file) { return '/mediapipe/' + file; } });
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: .5, minTrackingConfidence: .5 });
        faceMesh.onResults(function (results) {
          const points = results && results.multiFaceLandmarks && results.multiFaceLandmarks[0];
          if (!points || !points.length) return;
          let minX = 1, minY = 1, maxX = 0, maxY = 0;
          points.slice(0, 468).forEach(function (point) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); });
          face = smoothValues(face, [(minX + maxX) / 2, 1 - (minY + maxY) / 2, Math.max(.01, maxX - minX), Math.max(.01, maxY - minY)]);
          const left = points[468] || { x: (points[33].x + points[133].x) / 2, y: (points[33].y + points[133].y) / 2 };
          const right = points[473] || { x: (points[362].x + points[263].x) / 2, y: (points[362].y + points[263].y) / 2 };
          eyes = smoothValues(eyes, [left.x, 1 - left.y, right.x, 1 - right.y]);
        });
      } catch (_error) { faceMeshFailed = true; faceMesh = null; }
      return faceMesh;
    }
    function updateTrackedFace(source, width, height, mode) {
      if (options.trackFace === false || mode < 66 || faceDetectionBusy || performance.now() - lastFaceDetection < 120) return;
      faceDetectionBusy = true; lastFaceDetection = performance.now();
      const mesh = ensureFaceMesh();
      if (mesh) {
        mesh.send({ image: source }).catch(function () { faceMeshFailed = true; faceMesh = null; }).finally(function () { faceDetectionBusy = false; });
        return;
      }
      if (!faceDetector) { faceDetectionBusy = false; return; }
      faceDetector.detect(source).then(function (faces) {
        const box = faces && faces[0] && faces[0].boundingBox;
        if (!box) return;
        const x = Number(box.x != null ? box.x : box.left) || 0;
        const y = Number(box.y != null ? box.y : box.top) || 0;
        const w = Math.max(1, Number(box.width) || 1), h = Math.max(1, Number(box.height) || 1);
        const next = [(x + w / 2) / width, 1 - (y + h / 2) / height, w / width, h / height];
        face = smoothValues(face, next);
        eyes = smoothValues(eyes, [next[0] - next[2] * .18, next[1] + next[3] * .08, next[0] + next[2] * .18, next[1] + next[3] * .08]);
      }).catch(function () {}).finally(function () { faceDetectionBusy = false; });
    }
    return {
      render: function (source, effectId, time) {
        if (!source || !source.width && !source.videoWidth) return false;
        const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
        if (!width || !height) return false;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch (_error) { return false; }
        const mode = modes[effectId] || 0;
        updateTrackedFace(source, width, height, mode);
        gl.uniform1f(timeLocation, Number(time) || 0); gl.uniform1i(modeLocation, mode); gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform4f(faceLocation, face[0], face[1], face[2], face[3]);
        gl.uniform4f(eyesLocation, eyes[0], eyes[1], eyes[2], eyes[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 6); return true;
      }
    };
  }
  window.ReelEffects = { catalog: catalog, modes: modes, createRenderer: createRenderer };
})();
