const API_BASE = 'https://buildersclaw.vercel.app/api/v1';

async function runAgent() {
    console.log('🤖 Iniciando el agente...');

    // 1. Registro
    console.log('📝 Registrando nuevo agente...');
    const registerRes = await fetch(`${API_BASE}/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: `bot_${Math.random().toString(36).substring(2, 8)}`,
            display_name: 'Robot Competidor',
            personality: 'Soy un robot super rápido y escribo código limpio en React.',
            strategy: 'Cero errores, MVP rápido.'
        }),
    });

    const registerData = await registerRes.json();
    if (!registerRes.ok) throw new Error(`Falló el registro: ${JSON.stringify(registerData)}`);

    const apiKey = registerData.api_key || registerData.data?.api_key || registerData.data?.agent?.api_key;
    const agentName = registerData.name || registerData.data?.name || registerData.data?.agent?.name;

    console.log(`✅ Agente registrado exitosamente!`);
    console.log(`   Nombre: ${agentName}`);
    console.log(`   API Key: ${apiKey}`);

    // 2. Buscar hackatones abiertos
    console.log('\n🔍 Buscando hackatones disponibles...');
    const hackathonsRes = await fetch(`${API_BASE}/hackathons?status=open`);
    const hackathonsData = await hackathonsRes.json();

    if (!hackathonsRes.ok) throw new Error(`Error al buscar hackatones: ${JSON.stringify(hackathonsData)}`);

    if (!hackathonsData.data || hackathonsData.data.length === 0) {
        console.log('❌ No hay hackatones abiertos en este momento.');
        return;
    }

    const hackathon = hackathonsData.data[0];
    console.log(`🏆 Encontrado hackathon: "${hackathon.title}" (ID: ${hackathon.id})`);

    // 3. Entrar a la hackathon
    console.log('\n🚪 Intentando unirnos a la hackathon...');
    const joinRes = await fetch(`${API_BASE}/hackathons/${hackathon.id}/join`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: `Team ${agentName}`,
        }),
    });

    const joinData = await joinRes.json();
    if (!joinRes.ok) {
        if (joinRes.status === 402) {
            console.log('❌ Entrar falló: No hay fondos suficientes para pagar la entrada.');
        } else {
            console.log(`❌ Entrar falló: ${JSON.stringify(joinData)}`);
        }
        return;
    }

    const teamId = joinData.team?.id || joinData.data?.team?.id || joinData.data?.id || joinData.id;
    console.log(`✅ Entramos a la hackathon! Todo listo para competir.`);
    console.log(`   Tu ID de Equipo es: ${teamId || 'No encontrado'}`);
    console.log(`   Respuesta completa de unirse:`, JSON.stringify(joinData).slice(0, 150) + '...');

    if (!teamId) {
        console.log('❌ No pudimos extraer el teamId de la respuesta al anotarse. Abortando prompt.');
        return;
    }

    // 4. Enviar un prompt
    console.log('\n🚀 Mandando a construir nuestro primer archivo...');
    const promptBody = {
        prompt: `Crea un archivo index.html que muestre un titulo que diga "Hola Hackathon!"`,
        model: 'google/gemini-2.0-flash-001',
        max_tokens: 1500
    };

    const promptRes = await fetch(`${API_BASE}/hackathons/${hackathon.id}/teams/${teamId}/prompt`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(promptBody),
    });

    const promptData = await promptRes.json();
    if (!promptRes.ok) {
        if (promptRes.status === 402) {
            console.log('❌ El prompt falló: No tienes fondos suficientes.');
        } else {
            console.log(`❌ Falló la ejecución del prompt: ${JSON.stringify(promptData)}`);
        }
        return;
    }

    console.log(`✅ Código generado exitosamente!`);
    console.log(`🔗 Repo: ${promptData.github?.repo}`);
}

runAgent().catch(err => console.error('Error fatal del agente:', err));
