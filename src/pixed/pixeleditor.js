"use strict";

function PixelEditor(parentDiv, fmt, palette, initialData, thumbnails) {
  var self = this;
  var width = fmt.w;
  var height = fmt.h;

  function createCanvas(parent) {
    var c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    if (fmt.xform) c.style.transform = fmt.xform;
    c.classList.add("pixels");
    c.classList.add("pixelated");
    //canvas.tabIndex = "-1";               // Make it focusable
    $(parentDiv).empty().append(c);
    return c;
  }

  function updateImage() {
    ctx.putImageData(pixdata, 0, 0);
  }

  function commit() {
    if (!thumbnails) return;
    for (var i=0; i<thumbnails.length; i++) {
      thumbnails[i].copyImageFrom(self);
    }
    initialData.set(self.getImageColors());
  }

  this.copyImageFrom = function(src) {
    pixints.set(src.getImageData());
    updateImage();
  }

  this.getImageData = function() { return pixints.slice(0); }

  function fitCanvas() {
    var w = $(parentDiv).width();
    var h = $(parentDiv).height();
    if (h > w)
      pixcanvas.style.height = Math.floor(h)+"px";
    else
      pixcanvas.style.height = Math.floor(h/2)+"px";
    // TODO
  }
  this.resize = fitCanvas;

  var pixcanvas = createCanvas();
  var ctx = pixcanvas.getContext('2d');
  var pixdata = ctx.createImageData(width, height);
  var pixints = new Uint32Array(pixdata.data.buffer);
  for (var i=0; i<pixints.length; i++) {
    pixints[i] = initialData ? palette[initialData[i]] : palette[0];
  }

  updateImage();

  function revrgb(x) {
    var y = 0;
    y |= ((x >> 0) & 0xff) << 16;
    y |= ((x >> 8) & 0xff) << 8;
    y |= ((x >> 16) & 0xff) << 0;
    return y;
  }

  this.createPaletteButtons = function() {
    var span = $("#palette_group").empty();
    for (var i=0; i<palette.length; i++) {
      var btn = $('<button class="palbtn">');
      var rgb = palette[i] & 0xffffff;
      var color = "#" + hex(revrgb(rgb), 6);
      btn.click(self.setCurrentColor.bind(this, i));
      btn.attr('id', 'palcol_' + i);
      btn.css('backgroundColor', color).text(i.toString(16));
      if ((rgb & 0x808080) != 0x808080) { btn.css('color', 'white'); }
      span.append(btn);
    }
    self.setCurrentColor(1);
  }

  function getPixelByOffset(ofs) {
    var oldrgba = pixints[ofs] & 0xffffff;
    for (var i=0; i<palette.length; i++) {
      if (oldrgba == (palette[i] & 0xffffff)) return i;
    }
    return 0;
  }

  function getPixel(x, y) {
    var ofs = x+y*width;
    return getPixelByOffset(ofs);
  }

  function setPixel(x, y, col) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    var ofs = x+y*width;
    var oldrgba = pixints[ofs];
    var rgba = palette[col];
    if (oldrgba != rgba) {
      pixints[ofs] = rgba;
      updateImage();
    }
  }

  this.getImageColors = function() {
    var pixcols = new Uint8Array(pixints.length);
    for (var i=0; i<pixints.length; i++)
      pixcols[i] = getPixelByOffset(i);
    return pixcols;
  }

  ///

  this.makeEditable = function() {
    var curpalcol = -1;
    setCurrentColor(1);

    function getPositionFromEvent(e) {
      var x = Math.floor(e.offsetX * width / pxls.width());
      var y = Math.floor(e.offsetY * height / pxls.height());
      return {x:x, y:y};
    }

    function setCurrentColor(col) {
      if (curpalcol != col) {
        if (curpalcol >= 0)
          $("#palcol_" + curpalcol).removeClass('selected');
        curpalcol = col;
        $("#palcol_" + col).addClass('selected');
      }
    }
    self.setCurrentColor = setCurrentColor;

    var dragcol = 1;
    var dragging = false;

    var pxls = $(pixcanvas);
    pxls.mousedown(function(e) {
      var pos = getPositionFromEvent(e);
      dragcol = getPixel(pos.x, pos.y) == curpalcol ? 0 : curpalcol;
      setPixel(pos.x, pos.y, curpalcol);
      dragging = true;
      pixcanvas.setCapture();
    })
    .mousemove(function(e) {
      var pos = getPositionFromEvent(e);
      if (dragging) {
        setPixel(pos.x, pos.y, dragcol);
      }
    })
    .mouseup(function(e) {
      var pos = getPositionFromEvent(e);
      setPixel(pos.x, pos.y, dragcol);
      dragging = false;
      commit();
      pixcanvas.releaseCapture();
    });
  }

  this.rotate = function(deg) {
    console.log("rotate " + deg);
    var s1 = Math.sin(deg * Math.PI / 180);
    var c1 = Math.cos(deg * Math.PI / 180);
    var p = self.getImageColors();
    var i = 0;
    for (var y=0; y<height; y++) {
      for (var x=0; x<width; x++) {
        var xx = x + 0.5 - width/2.0;
        var yy = y + 0.5 - height/2.0;
        var xx2 = xx*c1 - yy*s1 + width/2.0 - 0.5;
        var yy2 = yy*c1 + xx*s1 + height/2.0 - 0.5;
        var col = getPixel(Math.round(xx2), Math.round(yy2));
        p[i++] = col;
      }
    }
    i = 0;
    for (var y=0; y<height; y++) {
      for (var x=0; x<width; x++) {
        setPixel(x, y, p[i++]);
      }
    }
    commit();
  }
}

/////////////////

var pixel_re = /([0#]?)([x$%])([0-9a-f]+)/gi;

function parseHexBytes(s) {
  var arr = [];
  var m;
  while (m = pixel_re.exec(s)) {
    var n;
    if (m[2].startsWith('%'))
      n = parseInt(m[3],2);
    else if (m[2].startsWith('x') || m[2].startsWith('$'))
      n = parseInt(m[3],16);
    else
      n = parseInt(m[3]);
    arr.push(n);
  }
  return arr;
}

function replaceHexBytes(s, bytes) {
  var result = "";
  var m;
  var li = 0;
  var i = 0;
  while (m = pixel_re.exec(s)) {
    result += s.slice(li, pixel_re.lastIndex - m[0].length);
    li = pixel_re.lastIndex;
    if (m[2].startsWith('%'))
      result += m[1] + "%" + bytes[i++].toString(2);
    else if (m[2].startsWith('x'))
      result += m[1] + "x" + hex(bytes[i++]);
    else if (m[2].startsWith('$'))
      result += m[1] + "$" + hex(bytes[i++]);
    else
      result += m[1] + bytes[i++].toString();
  }
  result += s.slice(li);
  return result;
}

function remapBits(x, arr) {
  if (!arr) return x;
  var y = 0;
  for (var i=0; i<arr.length; i++) {
    var s = arr[i];
    if (s < 0) {
      s = -s-1;
      y ^= 1 << s;
    }
    if (x & (1 << i)) {
      y ^= 1 << s;
    }
  }
  return y;
}

function convertBytesToImages(bytes, fmt) {
  var width = fmt.w;
  var height = fmt.h;
  var count = fmt.count || 1;
  var bpp = fmt.bpp || 1;
  var nplanes = fmt.np || 1;
  var bytesperline = fmt.sl || Math.ceil(width * bpp / 8);
  var mask = (1 << bpp)-1;
  var pofs = fmt.pofs || bytesperline*height*count;
  var images = [];
  for (var n=0; n<count; n++) {
    var imgdata = [];
    for (var y=0; y<height; y++) {
      var ofs0 = n*bytesperline*height + y*bytesperline;
      var shift = 0;
      for (var x=0; x<width; x++) {
        var color = 0;
        var ofs = remapBits(ofs0, fmt.remap);
        for (var p=0; p<nplanes; p++) {
          var byte = bytes[ofs + p*pofs];
          color |= ((fmt.brev ? byte>>(8-shift-bpp) : byte>>shift) & mask) << (p*bpp);
        }
        imgdata.push(color);
        shift += bpp;
        if (shift >= 8) {
          ofs0 += 1;
          shift = 0;
        }
      }
    }
    images.push(new Uint8Array(imgdata));
  }
  return images;
}

function convertImagesToBytes(images, fmt) {
  var width = fmt.w;
  var height = fmt.h;
  var count = fmt.count || 1;
  var bpp = fmt.bpp || 1;
  var nplanes = fmt.np || 1;
  var bytesperline = fmt.sl || Math.ceil(fmt.w * bpp / 8);
  var mask = (1 << bpp)-1;
  var pofs = fmt.pofs || bytesperline*height*count;
  var bytes = new Uint8Array(bytesperline*height*count*nplanes);
  for (var n=0; n<count; n++) {
    var imgdata = images[n];
    var i = 0;
    for (var y=0; y<height; y++) {
      var ofs0 = n*bytesperline*height + y*bytesperline;
      var shift = 0;
      for (var x=0; x<width; x++) {
        var color = imgdata[i++];
        var ofs = remapBits(ofs0, fmt.remap);
        for (var p=0; p<nplanes; p++) {
          var c = (color >> (p*bpp)) & mask;
          bytes[ofs + p*pofs] |= (fmt.brev ? (c << (8-shift-bpp)) : (c << shift));
        }
        shift += bpp;
        if (shift >= 8) {
          ofs0 += 1;
          shift = 0;
        }
      }
    }
  }
  return bytes;
}

function convertPaletteBytes(arr,r0,r1,g0,g1,b0,b1) {
  var result = [];
  for (var i=0; i<arr.length; i++) {
    var d = arr[i];
    var rgb = 0xff000000;
    rgb |= ((d >> r0) & ((1<<r1)-1)) << (0+8-r1);
    rgb |= ((d >> g0) & ((1<<g1)-1)) << (8+8-g1);
    rgb |= ((d >> b0) & ((1<<b1)-1)) << (16+8-b1);
    result.push(rgb);
  }
  return result;
}

var palette;
var paletteSets;
var paletteSetIndex=0;
var currentPixelEditor;
var parentSource;
var parentOrigin;
var allimages;
var currentFormat;
var currentByteStr;
var currentPaletteStr;
var currentPaletteFmt;
var allthumbs;

function pixelEditorDecodeMessage(e) {
  parentSource = e.source;
  parentOrigin = e.origin;
  currentFormat = e.data.fmt;
  currentByteStr = e.data.bytestr;
  currentPaletteFmt = e.data.palfmt;
  currentPaletteStr = e.data.palstr;
  var bytes = parseHexBytes(e.data.bytestr);
  allimages = convertBytesToImages(bytes, e.data.fmt);
  palette = [0xff000000, 0xffffffff]; // TODO
  if (currentPaletteStr) {
    var palbytes = parseHexBytes(e.data.palstr);
    var pal = currentPaletteFmt.pal;
    if (pal > 0) {
      var rr = Math.floor(Math.abs(pal/100) % 10);
      var gg = Math.floor(Math.abs(pal/10) % 10);
      var bb = Math.floor(Math.abs(pal) % 10);
      // TODO: n
      if (currentPaletteFmt.pal >= 0)
        palette = convertPaletteBytes(palbytes, 0, rr, rr, gg, rr+gg, bb);
      else
        palette = convertPaletteBytes(palbytes, rr+gg, bb, rr, gg, 0, rr);
    } else {
      var paltable = PREDEF_PALETTES[pal];
      if (paltable) {
        palette = palbytes.map(function(i) { return paltable[i]; });
      } else {
        alert("No palette named " + pal);
      }
    }
    if (currentPaletteFmt.n) {
      paletteSets = [];
      for (var i=0; i<palette.length; i+=currentPaletteFmt.n) {
        paletteSets.push(palette.slice(i, i+currentPaletteFmt.n));
      }
      palette = paletteSets[paletteSetIndex = 0];
      // TODO: swap palettes
    }
  } else {
    var ncols = (currentFormat.bpp || 1) * (currentFormat.np || 1);
    switch (ncols) {
      case 2:
        palette = [0xff000000, 0xffff00ff, 0xffffff00, 0xffffffff];
        break;
      // TODO
    }
    // TODO: default palette?
  }
  palette = new Uint32Array(palette);
}

function pixelEditorCreateThumbnails(e) {
  // create thumbnail for all images
  $("#thumbnaildiv").empty();
  var parentdiv;
  var count = e.data.fmt.count || 1;
  allthumbs = [];
  for (var i=0; i<count; i++) {
    if ((i & 15) == 0) {
      parentdiv = $("#thumbnaildiv").append("<div>");
    }
    allthumbs.push(createThumbnailForImage(parentdiv, i));
  }
}

function pixelEditorReceiveMessage(e) {
  pixelEditorDecodeMessage(e);
  pixelEditorCreateThumbnails(e);
  // create initial editor
  createEditorForImage(0);
}

function createThumbnailForImage(parentdiv, i) {
  var span = $('<span class="thumb">');
  var thumb = new PixelEditor(span, currentFormat, palette, allimages[i]);
  parentdiv.append(span);
  span.click(function() { createEditorForImage(i) });
  return thumb;
}

function createEditorForImage(i) {
  currentPixelEditor = new PixelEditor(maineditor, currentFormat, palette, allimages[i], [allthumbs[i]]);
  currentPixelEditor.resize();
  currentPixelEditor.makeEditable();
  currentPixelEditor.createPaletteButtons();
}

function postToParentWindow(data) {
  if (data.save) {
    var allimgs = [];
    for (var i=0; i<allthumbs.length; i++) {
      allimgs.push(allthumbs[i].getImageColors());
    }
    data.bytes = convertImagesToBytes(allimgs, currentFormat);
    data.bytestr = replaceHexBytes(currentByteStr, data.bytes);
  }
  if (parentSource) parentSource.postMessage(data, "*");
  return data;
}

function pixelEditorResize(e) {
  if (currentPixelEditor) {
    currentPixelEditor.resize();
  }
}

function pixelEditorKeypress(e) {
  if (!currentPixelEditor) return;
  var c = e.charCode;
  if (c >= 48 && c <= 57) {
    currentPixelEditor.setCurrentColor(c-48);
  } else if (c >= 97 && c <= 102) {
    currentPixelEditor.setCurrentColor(c-97+10);
  } else {
    switch (e.keyCode) {
      case 33: // PgUp
        currentPixelEditor.rotate(-90);
        break;
      case 34: // PgDn
        currentPixelEditor.rotate(90);
        break;
      case 35: // PgUp
        currentPixelEditor.rotate(-45);
        break;
      case 36: // PgDn
        currentPixelEditor.rotate(45);
        break;
      default:
        console.log(e);
        break;
    }
  }
}

var PREDEF_PALETTES = {
  'nes':[
      0xFF7C7C7C ,0xFF0000FC ,0xFF0000BC ,0xFF4428BC ,0xFF940084 ,0xFFA80020 ,0xFFA81000 ,0xFF881400
     ,0xFF503000 ,0xFF007800 ,0xFF006800 ,0xFF005800 ,0xFF004058 ,0xFF000000 ,0xFF000000 ,0xFF000000
     ,0xFFBCBCBC ,0xFF0078F8 ,0xFF0058F8 ,0xFF6844FC ,0xFFD800CC ,0xFFE40058 ,0xFFF83800 ,0xFFE45C10
     ,0xFFAC7C00 ,0xFF00B800 ,0xFF00A800 ,0xFF00A844 ,0xFF008888 ,0xFF000000 ,0xFF000000 ,0xFF000000
     ,0xFFF8F8F8 ,0xFF3CBCFC ,0xFF6888FC ,0xFF9878F8 ,0xFFF878F8 ,0xFFF85898 ,0xFFF87858 ,0xFFFCA044
     ,0xFFF8B800 ,0xFFB8F818 ,0xFF58D854 ,0xFF58F898 ,0xFF00E8D8 ,0xFF787878 ,0xFF000000 ,0xFF000000
     ,0xFFFCFCFC ,0xFFA4E4FC ,0xFFB8B8F8 ,0xFFD8B8F8 ,0xFFF8B8F8 ,0xFFF8A4C0 ,0xFFF0D0B0 ,0xFFFCE0A8
     ,0xFFF8D878 ,0xFFD8F878 ,0xFFB8F8B8 ,0xFFB8F8D8 ,0xFF00FCFC ,0xFFF8D8F8 ,0xFF000000 ,0xFF000000
   ]
};