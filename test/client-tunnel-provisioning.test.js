import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const read = (name) => readFile(new URL(`../deploy/${name}`, import.meta.url), 'utf8');

describe('provisionamento SSH restrito por cliente', () => {
  it('restringe conta e chave ao painel local', async () => {
    const script = await read('provision-client-tunnel.sh');

    assert.match(script, /PANEL_TARGET="127\.0\.0\.1:3100"/);
    assert.match(script, /restrict,port-forwarding,permitopen=/);
    assert.match(script, /AllowTcpForwarding local/);
    assert.match(script, /PermitOpen \$\{PANEL_TARGET\}/);
    assert.match(script, /PasswordAuthentication no/);
    assert.match(script, /AuthenticationMethods publickey/);
    assert.match(script, /PermitTTY no/);
    assert.match(script, /\/usr\/sbin\/nologin/);
    assert.doesNotMatch(script, /127\.0\.0\.1:8080/);
  });

  it('aceita somente identificador controlado e chave Ed25519 crua', async () => {
    const script = await read('provision-client-tunnel.sh');

    assert.match(script, /\^\[a-z0-9\]/);
    assert.match(script, /\^ssh-ed25519/);
    assert.match(script, /ssh-keygen -l -f/);
  });

  it('revoga a chave e encerra tuneis ativos da conta', async () => {
    const script = await read('revoke-client-tunnel.sh');

    assert.match(script, /install -m 0600/);
    assert.match(script, /passwd --lock/);
    assert.match(script, /pkill -KILL -u/);
    assert.doesNotMatch(script, /userdel/);
  });
});
