/**
 * Created by sam on 09.02.2015.
 */
import { ProvenanceGraph, StateNode, SlideNode } from 'phovea_core';
export declare class ThumbnailUtils {
    static thumbnail_url(graph: ProvenanceGraph, state: StateNode, options?: {}): any;
    static preview_thumbnail_url(graph: ProvenanceGraph, state: SlideNode, options?: {}): any;
    static screenshot_url(graph: ProvenanceGraph, state: StateNode, options?: {}): any;
    static areThumbnailsAvailable(graph: ProvenanceGraph): boolean;
}
