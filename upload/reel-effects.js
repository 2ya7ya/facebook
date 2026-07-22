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
    ['dream-glow', 'Dream Glow', 'Light']
  ].map(function (item, index) { return { id: item[0], name: item[1], category: item[2], mode: index }; });
  const modes = Object.fromEntries(catalog.map(function (effect) { return [effect.id, effect.mode]; }));

  const vertexSource = [
    'attribute vec2 a_position;',
    'varying vec2 v_uv;',
    'void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}'
  ].join('\n');
  const fragmentSource = [
    'precision mediump float;',
    'uniform sampler2D u_image; uniform vec2 u_resolution; uniform float u_time; uniform int u_mode;',
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
    ' gl_FragColor=vec4(clamp(c.rgb,0.,1.),1.);',
    '}'
  ].join('\n');

  function shader(gl, type, source) {
    const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item) || 'Effect shader failed.');
    return item;
  }
  function createRenderer(canvas) {
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
    return {
      render: function (source, effectId, time) {
        if (!source || !source.width && !source.videoWidth) return false;
        const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
        if (!width || !height) return false;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch (_error) { return false; }
        gl.uniform1f(timeLocation, Number(time) || 0); gl.uniform1i(modeLocation, modes[effectId] || 0); gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6); return true;
      }
    };
  }
  window.ReelEffects = { catalog: catalog, modes: modes, createRenderer: createRenderer };
})();
