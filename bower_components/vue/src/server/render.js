/* @flow */

import { encodeHTML } from 'entities'
import { compileToFunctions } from 'web/compiler/index'
import { createComponentInstanceForVnode } from 'core/vdom/create-component'

let warned = Object.create(null)
const warnOnce = msg => {
  if (!warned[msg]) {
    warned[msg] = true
    console.warn(`\n\u001b[31m${msg}\u001b[39m\n`)
  }
}

const normalizeAsync = (cache, method) => {
  const fn = cache[method]
  if (!fn) {
    return
  } else if (fn.length > 1) {
    return (key, cb) => fn.call(cache, key, cb)
  } else {
    return (key, cb) => cb(fn.call(cache, key))
  }
}

const compilationCache = Object.create(null)
const normalizeRender = vm => {
  const { render, template } = vm.$options
  if (!render) {
    if (template) {
      const renderFns = (
        compilationCache[template] ||
        (compilationCache[template] = compileToFunctions(template))
      )
      Object.assign(vm.$options, renderFns)
    } else {
      throw new Error(
        `render function or template not defined in component: ${
          vm.$options.name || vm.$options._componentTag || 'anonymous'
        }`
      )
    }
  }
}

export function createRenderFunction (
  modules: Array<Function>,
  directives: Object,
  isUnaryTag: Function,
  cache: any
) {
  if (cache && (!cache.get || !cache.set)) {
    throw new Error('renderer cache must implement at least get & set.')
  }

  const get = cache && normalizeAsync(cache, 'get')
  const has = cache && normalizeAsync(cache, 'has')

  // used to track and apply scope ids
  let activeInstance: any

  function renderNode (
    node: VNode,
    write: Function,
    next: Function,
    isRoot: boolean
  ) {
    if (node.componentOptions) {
      // check cache hit
      const Ctor = node.componentOptions.Ctor
      const getKey = Ctor.options.serverCacheKey
      const name = Ctor.options.name
      if (getKey && cache && name) {
        const key = name + '::' + getKey(node.componentOptions.propsData)
        if (has) {
          has(key, hit => {
            if (hit && get) {
              get(key, res => write(res, next))
            } else {
              renderComponentWithCache(node, write, next, isRoot, cache, key)
            }
          })
        } else if (get) {
          get(key, res => {
            if (res) {
              write(res, next)
            } else {
              renderComponentWithCache(node, write, next, isRoot, cache, key)
            }
          })
        }
      } else {
        if (getKey && !cache) {
          warnOnce(
            `[vue-server-renderer] Component ${
              Ctor.options.name || '(anonymous)'
            } implemented serverCacheKey, ` +
            'but no cache was provided to the renderer.'
          )
        }
        if (getKey && !name) {
          warnOnce(
            `[vue-server-renderer] Components that implement "serverCacheKey" ` +
            `must also define a unique "name" option.`
          )
        }
        renderComponent(node, write, next, isRoot)
      }
    } else {
      if (node.tag) {
        renderElement(node, write, next, isRoot)
      } else if (node.isComment) {
        write(`<!--${node.text}-->`, next)
      } else {
        write(node.raw ? node.text : encodeHTML(String(node.text)), next)
      }
    }
  }

  function renderComponent (node, write, next, isRoot) {
    const prevActive = activeInstance
    const child = activeInstance = createComponentInstanceForVnode(node, activeInstance)
    normalizeRender(child)
    const childNode = child._render()
    childNode.parent = node
    renderNode(childNode, write, () => {
      activeInstance = prevActive
      next()
    }, isRoot)
  }

  function renderComponentWithCache (node, write, next, isRoot, cache, key) {
    write.caching = true
    const buffer = write.cacheBuffer
    const bufferIndex = buffer.push('') - 1
    renderComponent(node, write, () => {
      const result = buffer[bufferIndex]
      cache.set(key, result)
      if (bufferIndex === 0) {
        // this is a top-level cached component,
        // exit caching mode.
        write.caching = false
      } else {
        // parent component is also being cached,
        // merge self into parent's result
        buffer[bufferIndex - 1] += result
      }
      buffer.length = bufferIndex
      next()
    }, isRoot)
  }

  function renderElement (el, write, next, isRoot) {
    if (isRoot) {
      if (!el.data) el.data = {}
      if (!el.data.attrs) el.data.attrs = {}
      el.data.attrs['server-rendered'] = 'true'
    }
    const startTag = renderStartingTag(el)
    const endTag = `</${el.tag}>`
    if (isUnaryTag(el.tag)) {
      write(startTag, next)
    } else if (!el.children || !el.children.length) {
      write(startTag + endTag, next)
    } else {
      const children: Array<VNode> = el.children || []
      write(startTag, () => {
        const total = children.length
        let rendered = 0

        function renderChild (child: VNode) {
          renderNode(child, write, () => {
            rendered++
            if (rendered < total) {
              renderChild(children[rendered])
            } else {
              write(endTag, next)
            }
          }, false)
        }

        renderChild(children[0])
      })
    }
  }

  function renderStartingTag (node: VNode) {
    let markup = `<${node.tag}`
    if (node.data) {
      // check directives
      const dirs = node.data.directives
      if (dirs) {
        for (let i = 0; i < dirs.length; i++) {
          const dirRenderer = directives[dirs[i].name]
          if (dirRenderer) {
            // directives mutate the node's data
            // which then gets rendered by modules
            dirRenderer(node, dirs[i])
          }
        }
      }
      // apply other modules
      for (let i = 0; i < modules.length; i++) {
        const res = modules[i](node)
        if (res) {
          markup += res
        }
      }
    }
    // attach scoped CSS ID
    let scopeId
    if (activeInstance &&
        activeInstance !== node.context &&
        (scopeId = activeInstance.$options._scopeId)) {
      markup += ` ${scopeId}`
    }
    while (node) {
      if ((scopeId = node.context.$options._scopeId)) {
        markup += ` ${scopeId}`
      }
      node = node.parent
    }
    return markup + '>'
  }

  return function render (
    component: Component,
    write: (text: string, next: Function) => void,
    done: Function
  ) {
    warned = Object.create(null)
    activeInstance = component
    normalizeRender(component)
    renderNode(component._render(), write, done, true)
  }
}
