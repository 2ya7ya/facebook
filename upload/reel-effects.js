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
    ['tunnel', 'Tunnel', 'Creative']
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
