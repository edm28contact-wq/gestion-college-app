(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const expressionsFrancaises=/\b(accès|administration|achat|action|application|article|autorisation|catégorie|code|commande|compte|configuration|connexion|date|donnée|erreur|facture|fichier|fournisseur|identifiant|information|inventaire|lecture|ligne|méthode|montant|mot de passe|produit|quantité|réponse|session|site|stock|serveur|utilisateur|valeur|verrouillé|introuvable|invalide|incorrect|obligatoire|requis|manquant|insuffisant|déjà|impossible)\b/i;

  function traduire(message,status=0){
    const m=String(message||'').trim();
    if(!m){
      if(status===401)return 'Votre session est expirée ou invalide.';
      if(status===403)return 'Vous n’avez pas l’autorisation nécessaire pour cette opération.';
      if(status===404)return 'L’élément demandé est introuvable.';
      if(status===409)return 'Cette opération entre en conflit avec une donnée existante.';
      if(status===429)return 'Trop de demandes ont été effectuées. Réessayez dans quelques instants.';
      return 'Une erreur est survenue. Réessayez.';
    }
    if(expressionsFrancaises.test(m))return m;
    const s=m.toLowerCase();
    if(s.includes('failed to fetch')||s.includes('networkerror')||s.includes('network request')||s.includes('load failed'))return 'Connexion au serveur impossible. Vérifiez votre connexion puis réessayez.';
    if(s.includes('timeout')||s.includes('timed out'))return 'Le délai d’attente a été dépassé. Réessayez.';
    if(s.includes('unauthorized')||s.includes('invalid jwt')||s.includes('jwt expired'))return 'Votre session est expirée ou invalide.';
    if(s.includes('forbidden')||s.includes('permission denied')||s.includes('not allowed'))return 'Vous n’avez pas l’autorisation nécessaire pour cette opération.';
    if(s.includes('not found')||s.includes('no rows'))return 'L’élément demandé est introuvable.';
    if(s.includes('duplicate')||s.includes('unique constraint')||s.includes('already exists'))return 'Cette donnée existe déjà.';
    if(s.includes('foreign key')||s.includes('violates foreign key'))return 'Cette opération est impossible car l’élément est encore utilisé ailleurs.';
    if(s.includes('invalid input')||s.includes('malformed')||s.includes('syntax error')||s.includes('invalid format'))return 'Le format des données saisies est invalide.';
    if(s.includes('payload too large')||status===413)return 'Le fichier ou les données envoyées sont trop volumineux.';
    if(s.includes('rate limit')||status===429)return 'Trop de demandes ont été effectuées. Réessayez dans quelques instants.';
    if(status===400)return 'Les données envoyées sont invalides ou incomplètes.';
    if(status===401)return 'Votre session est expirée ou invalide.';
    if(status===403)return 'Vous n’avez pas l’autorisation nécessaire pour cette opération.';
    if(status===404)return 'L’élément demandé est introuvable.';
    if(status===409)return 'Cette opération entre en conflit avec une donnée existante.';
    if(status>=500)return 'Une erreur interne est survenue. Réessayez dans quelques instants.';
    return 'Une erreur est survenue. Réessayez.';
  }

  window.erreurFrancaise=traduire;
  window.fetch=async(...args)=>{
    let response;
    try{response=await originalFetch(...args)}catch(e){throw new Error(traduire(e?.message||'',0))}
    if(response.ok)return response;
    const type=response.headers.get('content-type')||'';
    if(!type.toLowerCase().includes('application/json'))return response;
    try{
      const data=await response.clone().json();
      if(data&&typeof data==='object'&&typeof data.error==='string'){
        data.error=traduire(data.error,response.status);
        const headers=new Headers(response.headers);
        headers.set('content-type','application/json; charset=utf-8');
        return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
      }
    }catch{}
    return response;
  };
})();
