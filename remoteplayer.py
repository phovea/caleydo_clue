__author__ = 'Samuel Gratzl'

import flask

app = flask.Flask(__name__)

import caleydo_server.config

conf = caleydo_server.config.view('clue_demo')

import memcache

mc = memcache.Client(conf.get('memcached'), debug=0)
mc_prefix = 'clue_'


def generate_url(app, prov_id, state):
  base = '{0}{1}/#clue_graph={2}&clue_state={3}&clue=P&clue_store=remote&clue_headless=Y'

  return base.format(conf.server, app,
                     prov_id,
                     state)

def generate_slide_url(app, prov_id, slide):
  base = '{0}{1}/#clue_graph={2}&clue_slide={3}&clue=P&clue_store=remote&clue_headless=Y'

  return base.format(conf.server, app,
                     prov_id,
                     slide)

def create_via_selenium(url, width, height):
  from selenium import webdriver

  driver = webdriver.PhantomJS(executable_path=conf.phantomjs2)  # or add to your PATH
  driver.implicitly_wait(10)
  driver.set_window_size(width, height)  # optional
  print url
  driver.get(url)
  main_elem = driver.find_element_by_css_selector('main')
  for entry in driver.get_log('browser'):
    print entry
  check = driver.find_element_by_css_selector('body.clue_jumped')
  # try:
  # we have to wait for the page to refresh, the last thing that seems to be updated is the title
  # WebDriverWait(driver, 10).until(EC.title_contains("cheese!"))

  # You should see "cheese! - Google Search"
  # print driver.title

  # finally:
  #    driver.quit()
  # obj = main_elem.screenshot_as_png()
  obj = driver.get_screenshot_as_png()
  driver.quit()
  return obj


def create_via_phantomjs(url, width, height, format):
  import tempfile, os, gevent.subprocess as subprocess

  name = tempfile.mkstemp('.' + format)

  args = [conf.phantomjs2, os.path.join(os.getcwd(), 'plugins/clue_demo/phantom2_rasterize.js'), '' + url + '',
          '2' + name[1], str(width), str(height)]
  print ' '.join(args)
  proc = subprocess.Popen(args)
  print 'pre wait'
  proc.wait()
  print 'here'

  with open('2' + name[1], 'rb') as f:
    obj = f.readall()
  os.remove(name)
  return obj


def _create_screenshot_impl(app, prov_id, state, format, width=1920, height=1080):
  url = generate_url(app, prov_id, state)

  key = mc_prefix + url + 'w' + str(width) + 'h' + str(height)

  obj = mc.get(key)
  if not obj:
    print 'requesting url', url
    obj = create_via_selenium(url, width, height)
    # obj = create_via_phantomjs(url, width, height, format)
    mc.set(key, obj)
  return obj

def _create_preview_impl(app, prov_id, slide, format, width=1920, height=1080):
  url = generate_slide_url(app, prov_id, slide)

  key = mc_prefix + url + 'w' + str(width) + 'h' + str(height)

  obj = mc.get(key)
  if not obj:
    print 'requesting url', url
    obj = create_via_selenium(url, width, height)
    # obj = create_via_phantomjs(url, width, height, format)
    mc.set(key, obj)
  return obj

def fix_format(format):
  return 'jpeg' if format == 'jpg' else format

@app.route('/screenshot/<app>/<prov_id>/<state>.<format>')
def create_screenshot(app, prov_id, state, format):
  width = flask.request.args.get('width', 1920)
  height = flask.request.args.get('height', 1080)

  s = _create_screenshot_impl(app, prov_id, state, format, width, height)
  return flask.Response(s, mimetype='image/'+fix_format(format))


def to_thumbnail(s, width, format):
  import PIL.Image
  import io

  b = io.BytesIO(s)
  img = PIL.Image.open(b)

  wpercent = (width / float(img.size[0]))
  height = int(float(img.size[1]) * float(wpercent))
  img.thumbnail((width, height), PIL.Image.ANTIALIAS)

  b = io.BytesIO()
  img.save(b, fix_format(format))
  b.seek(0)
  obj = b.read()
  return obj

@app.route('/thumbnail/<app>/<prov_id>/<state>.<format>')
def create_thumbnail(app, prov_id, state, format):
  format = fix_format(format)
  width = int(flask.request.args.get('width', 128))

  url = generate_url(app, prov_id, state)

  key = mc_prefix + url + 't' + str(width)

  obj = mc.get(key)
  if not obj:
    s = _create_screenshot_impl(app, prov_id, state, format)
    obj = to_thumbnail(s, width, format)
    mc.set(key, obj)

  return flask.Response(obj, mimetype='image/'+format)

@app.route('/preview/<app>/<prov_id>/<slide>.<format>')
def create_preview(app, prov_id, slide, format):
  width = flask.request.args.get('width', 1920)
  height = flask.request.args.get('height', 1080)

  s = _create_preview_impl(app, prov_id, slide, format, width, height)
  return flask.Response(s, mimetype='image/'+fix_format(format))

@app.route('/preview_thumbnail/<app>/<prov_id>/<slide>.<format>')
def create_preview_thumbnail(app, prov_id, slide, format):
  format = fix_format(format)
  width = int(flask.request.args.get('width', 128))

  url = generate_slide_url(app, prov_id, slide)

  key = mc_prefix + url + 't' + str(width)

  obj = mc.get(key)
  if not obj:
    s = _create_preview_impl(app, prov_id, slide, format)
    obj = to_thumbnail(s, width, format)
    mc.set(key, obj)

  return flask.Response(obj, mimetype='image/'+format)


def create():
  """
   entry point of this plugin
  """
  app.debug = True
  return app


if __name__ == '__main__':
  app.debug = True
  app.run(host='0.0.0.0')