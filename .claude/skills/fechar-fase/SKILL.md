---
name: fechar-fase
description: Audita a fase/lote atual, decide se pode avançar, e ao final sempre explica em linguagem simples e pergunta antes de continuar. Use ao final de cada lote/fase do projeto SUED SYSTEM.
---

# Fechar fase — auditoria + avanço condicional + checkpoint com o usuário

## CONTEXTO

Projeto SUED SYSTEM. Fases fecham em lotes. Cada lote só avança depois
de auditoria própria validada — nunca confie cegamente em relatório
anterior, mesmo que tenha sido gerado por você mesmo.

## TAREFA

1. Rode a suíte completa de testes e confirme PASS/FAIL real e
   definitivo (número exato, sem ambiguidade). Se o número vier
   ambíguo (skips inesperados, contenção de conexão), diagnostique a
   causa antes de aceitar o resultado — reexecute isolado se
   necessário.
2. Rode `node --check` completo.
3. Confirme schema do banco contra o esperado.
4. Faça varredura final de resíduo de dados temporários em TODAS as
   tabelas (não pontual) — enumere tabelas/colunas via
   `information_schema`, não uma lista digitada à mão.
5. Confirme que o admin real está intacto.
6. Verifique ativamente (não de memória) se algum segredo, credencial
   ou dado sensível (incluindo tokens, senhas de teste, chaves)
   apareceu em texto puro em logs, arquivos temporários, ou na saída
   de comandos — e se sim, se ainda representa risco residual
   (token/conta ainda válidos) ou não (já invalidado/excluído).
7. Confirme se a validação HTTP/visual rodou contra produção ou
   staging. POLÍTICA JÁ DECIDIDA PELO USUÁRIO: enquanto o projeto
   estiver em fase de desenvolvimento (sem clientes/usuários reais
   usando o sistema no dia a dia), validar direto em produção é
   aceito — desde que sempre com conta de teste isolada e limpeza
   total ao final. Declare isso explicitamente no relatório, mas não
   trate como bloqueio nem pergunte de novo a cada lote. IMPORTANTE:
   se em algum momento você perceber sinais de que o site já está em
   uso real (dados de cliente real sendo criados fora do seu próprio
   teste, tráfego real, etc.), PARE e alerte o usuário antes de
   continuar validando em produção — essa política deve ser revisada
   antes do lançamento real.

## CRITÉRIO PARA AVANÇAR DE FASE (todos precisam ser verdadeiros)

- 100% dos testes em PASS (falha de infraestrutura re-testada e
  diferenciada de regressão real não bloqueia)
- node --check sem erro
- Schema e dados batendo com o esperado, zero resíduo confirmado por
  varredura completa
- Nenhum item da fase concluída depende de decisão de consultor
  pendente
- Nenhum segredo/dado sensível com risco residual real (conta ou
  token ainda válido)
- Nenhum segredo de infraestrutura exposto (DB URL, chaves de API,
  JWT secret, hash de senha)

## SE TODOS OS CRITÉRIOS FOREM ATENDIDOS

- Declare "Fase concluída e validada".
- Pode iniciar a próxima fase/lote, mas apenas itens já liberados
  (nunca itens marcados como dependentes de consultor).
- Antes de implementar cada item, explique brevemente o plano.

## SE ALGUM CRITÉRIO FALHAR

- PARE. Diagnostique a causa raiz.
- Correção pequena, técnica, segura, sem mudança de regra de negócio:
  corrija, teste, documente, reavalie.
- Mudança arquitetural, regra de negócio, custo/serviço externo,
  schema adicional: PARE e consulte antes de agir.

## NUNCA FAÇA

- Avançar para itens congelados/dependentes de consultor.
- Inventar regra de negócio nova.
- Abrir escopo novo a partir de melhoria cosmética não pedida.
- Assumir aprovação de uma prática de risco (ex: testar contra
  produção) só porque não houve objeção em lotes anteriores — se for
  relevante, declare e pergunte.

## RELATÓRIO TÉCNICO (obrigatório)

- Testes: contagem final e PASS/FAIL
- node --check
- Schema/banco
- Limpeza (confirmação de varredura completa)
- Admin real
- Segredos/dados sensíveis (achados + risco residual, mesmo que zero)
- Ambiente da validação (produção/staging)
- Arquivos alterados
- Itens da fase confirmados
- Problemas adicionais encontrados e tratamento
- Pendências de consultor

## EXPLICAÇÃO FINAL EM LINGUAGEM SIMPLES (obrigatório, sempre por último)

5-8 linhas, sem jargão técnico: o que passa a funcionar, o que ficou
pendente, se está seguro para continuar.

Depois disso, PARE e pergunte: "Posso continuar com as próximas
atualizações/alterações, ou prefere revisar antes?"

Não inicie nenhuma nova fase, tarefa ou alteração depois dessa
pergunta, mesmo que os critérios de avanço tenham sido atendidos.
Aguarde resposta do usuário.
