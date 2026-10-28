import { expect, test } from '@playwright/test';
import { bs, connectDirect, hostLobby, playOut, player, readyBoth, targetCell, waitTurn } from './util';

test('forward: the #a= tab hands the reply to the game tab', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  await hostLobby(A);
  await A.click('#use-direct');
  const offer = (await A.locator('#offer-link').textContent())!;
  await B.goto('http://' + offer);
  const answerLink = (await B.locator('#answer-link').textContent())!;
  const A2 = await A.context().newPage();
  await A2.goto('http://' + answerLink);
  await expect(A2.locator('#forwarded')).toContainText('Sent to your game tab');
  await expect(A.locator('.placement')).toBeVisible({ timeout: 20000 });
  await expect(B.locator('.placement')).toBeVisible({ timeout: 20000 });
});

test('cheat: a defender who reports a miss on a hit is caught and named', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  await connectDirect(A, B);
  await bs(B, 'setFleet', [
    { anchor: 30, vertical: false }, // Carrier A4-E4
    { anchor: 50, vertical: false },
    { anchor: 70, vertical: false },
    { anchor: 90, vertical: false },
    { anchor: 9, vertical: true },
  ]);
  await bs(B, 'lie', 'miss-on-hit', 'E4');
  await readyBoth(A, B);
  await playOut(A, B, A);
  await expect(A.locator('#verdict')).toContainText('Cheating detected: they reported a miss at E4 but a ship was there');
  await expect(B.locator('#their-verdict')).toHaveText("Opponent's check failed");
});

test('leave: closing the opponent page mid-battle shows "Your opponent left"', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  await connectDirect(A, B);
  await readyBoth(A, B);
  const p = await waitTurn(A, B);
  await targetCell(p!, 0).click();
  await B.close();
  await expect(A.locator('#notice')).toContainText('Your opponent left', { timeout: 15000 });
});

test('failed: an unreachable reply shows the failure notice and Retry returns home', async ({ browser }) => {
  test.setTimeout(60_000);
  const A = await player(browser);
  await hostLobby(A);
  await A.click('#use-direct');
  await expect(A.locator('#offer-link')).toBeVisible();
  const fake = await bs<string>(A, 'fakeAnswer');
  await A.fill('#paste', fake);
  await A.click('#connect');
  await expect(A.locator('#notice')).toContainText("Couldn't connect — your network may be blocking peer-to-peer", { timeout: 20000 });
  await A.click('#retry');
  await expect(A.locator('#create')).toBeVisible();
});

test('bad link: a truncated offer link explains itself', async ({ browser }) => {
  const A = await player(browser);
  await A.goto('./#o=EAR4d1ZSG');
  await expect(A.locator('#notice')).toContainText('That link looks incomplete');
});

test('leave: mid-game "Leave" asks first; Stay keeps playing, Leave ends it for both', async ({ browser }) => {
  const A = await player(browser);
  const B = await player(browser);
  await connectDirect(A, B);
  await A.click('#leave');
  await expect(A.locator('#stay')).toBeFocused();
  await A.click('#stay');
  await expect(A.locator('.placement')).toBeVisible();
  await expect(A.locator('#leave')).toBeVisible();
  await readyBoth(A, B);
  await A.click('#leave');
  await expect(A.locator('.battle')).toBeVisible();
  await A.click('#leave-yes');
  await expect(A.locator('#create')).toBeVisible();
  await expect(B.locator('#notice')).toContainText('Your opponent left');
});
