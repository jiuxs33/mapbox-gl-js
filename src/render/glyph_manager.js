// @flow

import loadGlyphRange from '../style/load_glyph_range';

import TinySDF from '@mapbox/tiny-sdf';
import isChar from '../util/is_char_in_unicode_block';
import { asyncAll } from '../util/util';
import { AlphaImage } from '../util/image';

import type {StyleGlyph} from '../style/style_glyph';
import type {RequestManager} from '../util/mapbox';
import type {Callback} from '../types/callback';
import md5 from 'md5';

type Entry = {
    // null means we've requested the range, but the glyph wasn't included in the result.
    glyphs: {[id: number]: StyleGlyph | null},
    requests: {[range: number]: Array<Callback<{[number]: StyleGlyph | null}>>},
    tinySDF?: TinySDF
};

class GlyphManager {
    requestManager: RequestManager;
    localIdeographFontFamily: ?string;
    entries: {[string]: Entry};
    url: ?string;
    finded:[];

    // exposed as statics to enable stubbing in unit tests
    static loadGlyphRange: typeof loadGlyphRange;
    static TinySDF: Class<TinySDF>;

    constructor(requestManager: RequestManager, localIdeographFontFamily: ?string) {
        this.requestManager = requestManager;
        this.localIdeographFontFamily = localIdeographFontFamily;
        this.entries = {};
        this.finded = [];
    }

    setURL(url: ?string) {
        this.url = url;
    }

    getGlyphs(glyphs: {[stack: string]: Array<number>}, callback: Callback<{[stack: string]: {[id: number]: ?StyleGlyph}}>) {
        const all = [];
        const allids = [];
        
        for (const stack in glyphs) {
            let entry = this.entries[stack];
            
            for (const id of glyphs[stack]) {
                all.push({stack, id});
                if(entry){
                    let glyph = entry.glyphs[id];
                    if (glyph == undefined) {
                        allids.push(id);
                    }
                }else{
                    allids.push(id);
                }
            }
        }

        asyncAll(all, ({stack, id}, callback: Callback<{stack: string, id: number, glyph: ?StyleGlyph}>,items) => {
            let entry = this.entries[stack];
            if (!entry) {
                entry = this.entries[stack] = {
                    glyphs: {},
                    requests: {}
                };
            }
            let glyph = entry.glyphs[id];
            if (glyph !== undefined) {
                callback(null, {stack, id, glyph});
                return;
            }
            glyph = this._tinySDF(entry, stack, id);
            if (glyph) {
                callback(null, {stack, id, glyph});
                return;
            }
            
            
            /*const range = Math.floor(id / 256);
            if (range * 256 > 65535) {
                callback(new Error('glyphs > 65535 not supported'));
                return;
            }*/
            let _range = md5(items.join("_"));
            //let _range = items.join("_");
            let requests = entry.requests[_range];
            if (!requests) {
                requests = entry.requests[_range] = [];
                let findfonts = [];
                let temp_id = 0;
                for (const font of items) {
                     let f_id = font - temp_id;
                    findfonts.push(f_id);
                    temp_id = font;
                }
                let range = findfonts.join(',');
                GlyphManager.loadGlyphRange(stack, range, (this.url: any), this.requestManager,
                    (err, response: ?{[number]: StyleGlyph | null}) => {
                        if (response) {
                            for (const id in response) {
                                if(!entry.glyphs[+id]){
                                    entry.glyphs[+id] = response[+id];
                                }
                            }
                        }
                        for (const cb of requests) {
                            cb(err, response);
                        }
                        delete entry.requests[_range];
                    });
            }

            requests.push((err, result: ?{[number]: StyleGlyph | null}) => {
                if (err) {
                    callback(err);
                } else if (result) {
                    callback(null, {stack, id, glyph: result[id] || null});
                }
            });
        }, (err, glyphs: ?Array<{stack: string, id: number, glyph: ?StyleGlyph}>) => {
            if (err) {
                callback(err);
            } else if (glyphs) {
                const result = {};

                for (const {stack, id, glyph} of glyphs) {
                    // Clone the glyph so that our own copy of its ArrayBuffer doesn't get transferred.
                    (result[stack] || (result[stack] = {}))[id] = glyph && {
                        id: glyph.id,
                        bitmap: glyph.bitmap.clone(),
                        metrics: glyph.metrics
                    };
                }

                callback(null, result);
            }
        },allids);
    }

    _tinySDF(entry: Entry, stack: string, id: number): ?StyleGlyph {
        const family = this.localIdeographFontFamily;
        if (!family) {
            return;
        }
        /* eslint-disable new-cap */
        if (!isChar['CJK Unified Ideographs'](id) &&
            !isChar['Hangul Syllables'](id) &&
            !isChar['Hiragana'](id) &&
            !isChar['Katakana'](id)
        ) { /* eslint-enable new-cap */
            return;
        }

        let tinySDF = entry.tinySDF;
        if (!tinySDF) {
            let fontWeight = '400';
            if (/bold/i.test(stack)) {
                fontWeight = '900';
            } else if (/medium/i.test(stack)) {
                fontWeight = '500';
            } else if (/light/i.test(stack)) {
                fontWeight = '200';
            }
            tinySDF = entry.tinySDF = new GlyphManager.TinySDF(24, 3, 8, .25, family, fontWeight);
        }

        return {
            id,
            bitmap: new AlphaImage({width: 30, height: 30}, tinySDF.draw(String.fromCharCode(id))),
            metrics: {
                width: 24,
                height: 24,
                left: 0,
                top: -8,
                advance: 24
            }
        };
    }
}

GlyphManager.loadGlyphRange = loadGlyphRange;
GlyphManager.TinySDF = TinySDF;

export default GlyphManager;
