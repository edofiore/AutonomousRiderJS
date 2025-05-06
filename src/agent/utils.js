import dijkstra from 'graphology-shortest-path';
import { mapGraph } from './belief/index.js';

// Function to compute the distance (number of cells/steps) between 2 cells
export function distance( {x:x1, y:y1}, {x:x2, y:y2} ) {
    // console.log("{x1: %\i, y1: %\i}, {x2: %\i, y2: %\i}", x1, y1, x2, y2)
    
    if(x1 && y1 && x2 && y2) {
        let path = dijkstra.bidirectional(mapGraph, Math.floor(x1) + "-" + Math.floor(y1), Math.floor(x2) + "-" + Math.floor(y2))
    
        if(!path){
            if(mapGraph.hasNode(Math.floor(x1) + "-" + Math.floor(y1)) && mapGraph.hasNode(Math.floor(x2) + "-" + Math.floor(y2))){
                console.log("WRONG POSITIONS:", Math.floor(x1) + "-" + Math.floor(y1), Math.floor(x2) + "-" + Math.floor(y2));
            }
            return Number.MAX_VALUE;
        }
        
        return path.length - 1;
    }
}

// export function distance( {x:x1, y:y1}, {x:x2, y:y2}) {
//     const dx = Math.abs( Math.round(x1) - Math.round(x2) )
//     const dy = Math.abs( Math.round(y1) - Math.round(y2) )
//     return dx + dy;
// }