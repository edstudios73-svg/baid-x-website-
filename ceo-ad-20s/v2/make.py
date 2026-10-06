t = open('template.html').read()
for name, layer in (('board.html', 'all'), ('bg.html', 'bg'), ('desk.html', 'desk'), ('gfx.html', 'gfx'), ('gfxk.html', 'gfx kbg'), ('gfxw.html', 'gfx wbg')):
    open(name, 'w').write(t.replace('__LAYER__', layer))
