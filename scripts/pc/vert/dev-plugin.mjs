import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Astro's dev public-file server does not resolve directory index pages.
// VERT's static router uses clean paths; production static hosts already do this.
export function vertStaticDevRoutes() {
 return { name:'webpc-vert-static-dev-routes',apply:'serve',configureServer(server){
  server.middlewares.use((request,response,next)=>{
   const url=new URL(request.url??'/','http://localhost');
   if(request.method==='GET'&&/^\/pc\/vendor\/vert(?:\/(?:about|convert|debug|jpegify|privacy|settings))?\/?$/.test(url.pathname)){
    const directory=url.pathname.endsWith('/')?url.pathname:url.pathname+'/';
    const file=fileURLToPath(new URL('../../../public'+directory+'index.html',import.meta.url));
    if(existsSync(file)){
     if(directory!==url.pathname){response.writeHead(302,{Location:directory+url.search});response.end();return}
     request.url=directory+'index.html'+url.search;
    }
   }
   next();
  });
 }};
}
