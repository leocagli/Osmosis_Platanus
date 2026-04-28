const API_BASE = 'https://buildersclaw.vercel.app/api/v1';

// NOTA: Un agente real necesita acceso al token de GitHub (PAT) para crear el repositorio
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'PONER_TU_TOKEN_PERSONAL_DE_GITHUB';
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'TU_USUARIO';

async function compete() {
    try {
        console.log('🤖 AGENTE ONLINE. Iniciando flujo autónomo...\n');

        // 1. Registro
        console.log('📝 1. Registrando en BuildersClaw...');
        const regRes = await fetch(`${API_BASE}/agents/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `agent_${Date.now()}`, display_name: 'Antigravity Autonomous' })
        });
        const regData = await regRes.json();
        const apiKey = regData.api_key || regData.data?.api_key || regData.data?.agent?.api_key;
        const agentName = regData.name || regData.data?.name || regData.data?.agent?.name;
        console.log(`✅ Registrado! API Key: ${apiKey}\n`);

        // 2. Open Hackathons
        console.log('🔍 2. Buscando competencias abiertas...');
        const openRes = await fetch(`${API_BASE}/hackathons?status=open`);
        const openData = await openRes.json();
        if (!openData.data || openData.data.length === 0) return console.log('❌ No hay.');

        const hackathon = openData.data[0];
        console.log(`🏆 Torneo encontrado: "${hackathon.title}"\n`);

        // 3. Join
        console.log('🚪 3. Uniéndose al equipo...');
        const joinRes = await fetch(`${API_BASE}/hackathons/${hackathon.id}/join`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `Equipo Autónomo` })
        });
        const joinDataText = await joinRes.text();
        let joinData; try { joinData = JSON.parse(joinDataText); } catch (e) { joinData = joinDataText; }
        if (!joinRes.ok) return console.log('❌ Error al unirse:', joinData);

        const teamId = joinData.team?.id || joinData.data?.team?.id || joinData.data?.id || joinData.id;
        console.log(`✅ Adentro! Team ID: ${teamId}\n`);

        // 4. El Agente usa una IA local/externa para programar (Acá lo simulamos)
        console.log(`💻 4. Programando la solución... (Agente pensando 🧠)`);
        const htmlSolution = `<!DOCTYPE html><html><body><h1>Generado 100% por el bot</h1><p>Esta es mi submission!</p></body></html>`;

        // 5. Creando Repo en Github a través de la API
        console.log(`🐙 5. Creando nuevo repositorio público en GitHub para entregar...`);
        const repoName = `buildersclaw-submission-${Date.now()}`;

        if (GITHUB_TOKEN === 'PONER_TU_TOKEN_PERSONAL_DE_GITHUB') {
            console.log('⚠️ FRENANDO EL SCRIPT: Necesitas agregar tu GITHUB_TOKEN en el código para que el bot pueda crear el repo real.');
            return;
        }

        const ghRepoRes = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ name: repoName, private: false, description: "Mi submission autogenerada para BuildersClaw" })
        });
        const ghRepoData = await ghRepoRes.json();
        if (!ghRepoRes.ok) return console.log('❌ Falló la creación del Repo en Github:', ghRepoData);

        const finalRepoUrl = ghRepoData.html_url;
        console.log(`✅ Repositorio oficial creado: ${finalRepoUrl}`);

        // 6. Subiendo el código al repositorio recién creado
        console.log(`📤 Subiendo el código (commit)...`);
        await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${repoName}/contents/index.html`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: '🤖 Autonomous agent initial commit',
                content: Buffer.from(htmlSolution).toString('base64')
            })
        });
        console.log(`✅ Código pusheado a GitHub.\n`);

        // 7. Enviar la URL a BuildersClaw
        console.log(`🚀 6. Haciendo el submit final de la competencia con nuestro nuevo Link...`);
        const subRes = await fetch(`${API_BASE}/hackathons/${hackathon.id}/teams/${teamId}/submit`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo_url: finalRepoUrl, notes: "Repo generado en tiempo real por el agente" })
        });

        const subDataText = await subRes.text();
        let subData; try { subData = JSON.parse(subDataText); } catch (e) { subData = subDataText; }

        if (subRes.ok) console.log(`🎉 ¡Submit exitoso! Esperando al Jurado IA.`);
        else console.log(`❌ Falló el submission de BuildersClaw:`, subData);

    } catch (err) {
        console.error('Error:', err.message);
    }
}
compete();
