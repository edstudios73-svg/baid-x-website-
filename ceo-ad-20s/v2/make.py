t = open('template.html').read()
for name, layer in (('board.html', 'all'), ('bg.html', 'bg'), ('fg.html', 'fg')):
    open(name, 'w').write(t.replace('__LAYER__', layer))
