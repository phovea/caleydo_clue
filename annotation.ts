/**
 * Created by Samuel Gratzl on 15.10.2015.
 */

import C = require('../caleydo_core/main');
import prov = require('../caleydo_provenance/main');
import cmode = require('../caleydo_provenance/mode');
import d3 = require('d3');
import marked = require('marked');
import {defaultSelectionType} from '../caleydo_core/idtype';

const modeFeatures = {
  isEditable: () => cmode.getMode().authoring > 0.8
};

export class Renderer {
  private options = {
    animation: true,
    duration: 100,
    markdown: true,
    renderSubtitle: true,
    subtitlePattern : '${name}'
  };

  private prev = Promise.resolve(null);

  private l = (event, state) => this.render(state);
  private updateAnnotations = () => this.renderAnnotationsImpl(this.act);
  private rerender = () => this.render(this.act);

  private act : prov.SlideNode = null;

  private renderer = this.rendererImpl.bind(this);

  constructor(private $main:d3.Selection<any>, private graph:prov.ProvenanceGraph, options = {}) {
    C.mixin(this.options, options);

    this.graph.on('select_slide_'+defaultSelectionType, this.l);

    C.onDOMNodeRemoved(<Element>$main.node(), this.destroy.bind(this));

    cmode.on('modeChanged', this.rerender);
  }

  private rendererImpl(d: string) {
    if (modeFeatures.isEditable() && d.length === 0) {
      return `<i class="placeholder">Enter Text by Clicking (MarkDown supported)</i>`;
    }
    if (this.act) {
      let vars : any = {
        name : this.act.name,
        duration: this.act.duration,
        slide_number : this.act.slideIndex
      };
      let s = this.act.state;
      if (s) {
        vars.state_name = s.name;
        vars.state_notes = s.getAttr('notes');
        let a = s.creator;
        if (a) {
          let aa = a.meta;
          vars.action_name = aa.name;
          vars.action_category = aa.category;
          vars.action_operation = aa.operation;
          vars.action_user = aa.user;
          vars.action_ts = new Date(aa.timestamp);
        }
      }
      d = this.replaceVariables(d, vars);
    }
    return (this.options.markdown ? marked(d) : d);
  }

  private replaceVariables(d: string, vars: { [key: string] : string }) {
    return d.replace(/\$\{([^}]+)\}/gi, function (match, variable) {
      var r = vars[variable];
      if (r) {
        return r;
      }
      return "$variable$";
    });
  }

  private destroy() {
    this.graph.off('select_slide_'+defaultSelectionType, this.l);

    cmode.off('modeChanged', this.rerender);
  }

  render(state:prov.SlideNode) {
    if (this.act) {
      this.act.off('push-annotations,attr-name,attr-duration', this.updateAnnotations);
    }
    //create full chain
    this.prev = this.prev.then(() => {
      var takedown = this.hideOld();
      this.act = state;
      if (!state) {
        return takedown;
      }
      this.act.on('push-annotations,attr-name,attr-duration', this.updateAnnotations);

      if (cmode.getMode().exploration > 0.8) {
        return takedown;
      }
      var next = Promise.resolve(null);
      if (state.isTextOnly) {
        next = this.renderText(state);
      } else {
        next = this.graph.jumpTo(state.state);
      }
      return Promise.all([takedown, next, this.options.renderSubtitle ? this.renderSubtitle(state) : Promise.resolve(null), this.renderAnnotations(state)]); //, this.renderArrows(state)]);
    });
    return this.prev;
  }

  private renderAnnotationsImpl(state:prov.SlideNode) {
    const that = this;
    const editable = modeFeatures.isEditable() && state != null;

    const $anns = this.$main.selectAll('div.annotation').data(state ? state.annotations : [], (d,i) => d.type+i);
    const $anns_enter = $anns.enter().append('div')
      .attr('class',(d) => d.type+'-annotation annotation');

    const updateTransform = (d:prov.IStateAnnotation) => `translate(${d.pos[0]},${d.pos[1]})rotate(${(<any>d).rotation || 0}deg)`;
    //move
    $anns_enter.append('button').attr('tabindex', -1).attr('class', 'btn btn-default btn-xs fa fa-arrows').call(d3.behavior.drag()
      //.origin((d:prov.IStateAnnotation) => ({x: d.pos[0], y: d.pos[1]}))
      .on('drag', function (d:prov.IStateAnnotation, i) {
        var mouse = d3.mouse(this.parentNode.parentNode);
        const bounds = C.bounds(this.parentNode.parentNode);
        d.pos = [mouse[0]*100/bounds.w,mouse[1]*100/bounds.h]; //[d.x, d.y];
        state.setAnnotation(i, d);
        d3.select(this.parentNode).style('left', d.pos[0] + '%').style('top', d.pos[1] + '%');
      }));

    $anns_enter.append('button').attr('tabindex', -1).attr('class', 'btn btn-default btn-xs fa fa-times')
      .on('click', function (d:prov.IStateAnnotation, i) {
        d3.select(this.parentNode).remove();
        state.removeAnnotation(i);
        d3.event.preventDefault();
      });


    //Text
    $anns.filter((d) => d.type === 'text' || !d.hasOwnProperty('type')).call(($texts: d3.selection.Update<prov.ITextStateAnnotation>, $texts_enter: d3.selection.Update<prov.ITextStateAnnotation>) => {

      let onEdit = function (d:prov.ITextStateAnnotation, i) {
        const $elem = d3.select(this);
        if (!d3.select(this.parentNode).classed('editable')) {
          return;
        }
        $elem.on('click', null);
        $elem.append('textarea').property('value', d.text).on('blur', function () {
          d.text = this.value;
          state.setAnnotation(i, d);
          //update value and enable edit click handler again
          $elem.html(that.renderer(this.value)).on('click', onEdit);
        });
      };
      $texts_enter.append('div').classed('text',true).on('click', onEdit);

      $texts.select('div.text').html((d) => this.renderer(d.text)).style({
        width: (d:prov.ITextStateAnnotation) => d.size ? d.size[0] + 'px' : null,
        height: (d:prov.ITextStateAnnotation) => d.size ? d.size[1] + 'px' : null,
        transform: updateTransform
      }).each(function (d) {
        if (d.styles) {
          d3.select(this).style(d.styles);
        }
      });
    }, $anns_enter.filter((d) => d.type === 'text' || !d.hasOwnProperty('type')));


    //Arrow
    $anns.filter((d) => d.type === 'arrow').call(($arrows: d3.selection.Update<prov.IArrowStateAnnotation>, $arrows_enter: d3.selection.Update<prov.IArrowStateAnnotation>) => {
      var $svg_enter = $arrows_enter.insert('svg',':first-child').attr({
          width: (d) => 30+Math.abs(d.at[0]),
          height: (d) => 30+Math.abs(d.at[1])
        }).style({
          left: (d) => (-15 + Math.min(0,d.at[0]))+'px',
          top: (d) => (-15 + Math.min(0,d.at[1]))+'px'
        });
      $svg_enter.append('defs').append('marker').attr({
          id: (d,i) => 'clue_text_arrow_marker'+i,
          viewBox: '0 0 10 10',
          refX: 6,
          refY: 5,
          markerWidth: 4,
          markerHeight: 3,
          markerUnits: 'strokeWidth',
          orient: 'auto'
        }).append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z');
      $svg_enter.append('g').append('line').classed('arrow',true).attr({
        'marker-end': (d,i) => 'url(#clue_text_arrow_marker'+i+')'
      });

      var $svg = $arrows.select('svg');

      function updateShift() {
        $svg.attr({
          width: (d) => 30+Math.abs(d.at[0]),  //TODO (50) + xminmax[1] - xminmax[0],
          height: (d) => 30+Math.abs(d.at[1]) //TODO yminmax[1] - yminmax[0],
        }).style({
          left: (d) => (-15 + Math.min(0,d.at[0]))+'px',
          top: (d) => (-15 + Math.min(0,d.at[1]))+'px'
        });
        $svg.select('g').attr('transform', (d) => `translate(${-Math.min(0,d.at[0])+15},${-Math.min(0,d.at[1])+15})`);
      }

      $svg_enter.select('g').append('circle').classed('anchor',true).attr('r', 5);
      $svg.select('circle').style({
        cx: (d) => d.at[0],
        cy: (d) => d.at[1]
      }).call(d3.behavior.drag()
        .on('drag', function (d:prov.IArrowStateAnnotation, i) {
          const e:any = d3.event;
          d.at = [e.x, e.y];
          state.setAnnotation(i, d);
          d3.select(this).style({
            cx: d.at[0],
            cy: d.at[1]
          });
          $svg.select('line[data-index="'+i+'"]').attr({
            x2: d.at[0],
            y2: d.at[1]
          });
          updateShift();
        }));
      updateShift();
      $svg.select('line').attr({
        'data-index': (d,i) => i,
        x2: (d) => d.at[0],
        y2: (d) => d.at[1]
      }).each(function (d) {
        if (d.styles) {
          d3.select(this).style(d.styles);
        }
      });
    }, $anns_enter.filter((d) => d.type === 'arrow'));

    //FRAME
    $anns.filter((d) => d.type === 'frame').call(($frames: d3.selection.Update<prov.IFrameStateAnnotation>, $frames_enter: d3.selection.Update<prov.IFrameStateAnnotation>) => {
      $frames.style({
        width: (d) => d.size[0] + '%',
        height: (d) => d.size[1] + '%'
      }).each(function (d) {
        if (d.styles) {
          d3.select(this).style(d.styles);
        }
      });

      //resize
      $frames_enter.append('button').attr('tabindex',-1).attr('class', 'btn btn-default btn-xs fa fa-expand fa-flip-horizontal')
        .call(d3.behavior.drag()
          .on('drag', function (d:prov.IFrameStateAnnotation, i) {
            var mouse = d3.mouse(this.parentNode.parentNode);
            const bounds = C.bounds(this.parentNode.parentNode);
            d.size = [mouse[0]*100/bounds.w-d.pos[0], mouse[1]*100/bounds.h-d.pos[1]];
            state.setAnnotation(i, d);
            d3.select(this.parentNode).style({
              width: (d:prov.IFrameStateAnnotation) => d.size ? d.size[0] + '%' : null,
              height: (d:prov.IFrameStateAnnotation) => d.size ? d.size[1] + '%' : null
            });
        }));

    }, $anns_enter.filter((d) => d.type === 'frame'));

    $anns.style({
      left: (d:prov.IStateAnnotation) => d.pos[0] + '%',
      top: (d:prov.IStateAnnotation) => d.pos[1] + '%'
    }).classed('editable',editable);

    $anns.exit().remove();

    return $anns;
  }

  renderAnnotations(state:prov.SlideNode) {
    return new Promise((resolve) => {
      const $anns = this.renderAnnotationsImpl(state);
      if (this.options.animation && !$anns.empty()) {
        $anns.style('opacity', 0).transition().duration(this.options.duration).style('opacity', 1).each('end', () => {
          resolve($anns.node());
        });
      } else {
        $anns.style('opacity', 1);
        resolve($anns.node());
      }
    });
  }



  hideOld() {
    return new Promise((resolve) => {
      const $div = this.$main.classed('hide-all-non-annotations',false).selectAll('div.annotation, div.text-overlay, div.add-text-annotation, div.subtitle-annotation');
      if (this.options.animation && !$div.empty()) {
        $div.transition().duration(this.options.duration).style('opacity', 0).each('end', () => {
          resolve();
        }).remove();
      } else {
        $div.remove();
        resolve();
      }
    });
  }

  renderSubtitle(overlay:prov.SlideNode) {
    return new Promise((resolve) => {
      this.$main.append('div').attr('class', 'subtitle-annotation').html(this.renderer(this.options.subtitlePattern));
      resolve(this.$main.node());
    });
  }

  renderText(overlay:prov.SlideNode) {
    return new Promise((resolve) => {
      this.$main.classed('hide-all-non-annotations', true);
      resolve(this.$main.node());
    });
  }
}

export function create(main:HTMLElement, graph:prov.ProvenanceGraph) {
  const instance = new Renderer(d3.select(main), graph);
  return {
    render: instance.render.bind(instance)
  };
}
