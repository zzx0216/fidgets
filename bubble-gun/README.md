# 哒哒哒 · bubble-gun

把聊天里的一条气泡拆成一个个字，像机关枪一样哒哒哒射向对方的头像。前几个字一颗颗射、越射越快，剩下的一把齐射；每颗打中头像都会把它往后顶一下，连中会越抖越厉害；打中的字弹开、掉到聊天区底部堆起来，手指可以拖着玩，闲置几秒后淡掉。气泡射空了，再从原位冒回来。

一个 JS 文件，零依赖；页面上有 [matter.js](https://brm.io/matter-js/) 的话地上的字会有真的物理（能堆、能拖），没有就弹开淡出。

Take a chat bubble apart letter by letter and machine-gun it at an avatar. Every hit knocks the avatar back; the letters ricochet and pile up on the floor where you can drag them around. Zero dependencies; optional matter.js for real physics on the pile.

**Demo**：[zziying.github.io/fidgets/bubble-gun](https://zziying.github.io/fidgets/bubble-gun/)（手机上最好玩），或者直接打开 `index.html`。

## 用法

```html
<!-- 可选：地上的字用真物理 -->
<script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
<script src="bubble-gun.js"></script>
<script>
  BubbleGun.tune.floor = document.querySelector(".chat");   // 字堆在哪个元素的底边（不设 = 屏幕底）

  // 射：bubble = 要拆的气泡元素，target = 头像元素
  BubbleGun.fire(bubble, avatar).then((played) => {
    // played=false：正在射上一梭子 / 气泡不在屏幕里 / reduced-motion，什么都没演
  });

  // target 也可以是函数，每帧调一次，适合目标会动、会被虚拟列表换掉的场景
  BubbleGun.fire(bubble, () => ({ x, y, r, el }));   // 圆心、半径、挨打要抖的元素（el=null 就射进空气里）
</script>
```

射的时候原气泡会 `visibility: hidden`，整场在一张全屏 `<canvas>`（`pointer-events: none`）上画，所以不管气泡里是什么排版，都不会动你的 DOM 布局。头像挨打的抖动是往它的 inline `transform` 后面追加 `translate/scale`，射完还原。

### 手感参数 `BubbleGun.tune`

| 参数 | 默认 | 说明 |
|---|---|---|
| `first` | 56 | 前多少个字一颗颗射，剩下的一把齐射 |
| `gapStart` / `gapEnd` | 88 / 38 | 发射间隔 ms，从起始慢慢加速到最快 |
| `flyMs` | 170 | 子弹飞行时间 |
| `scatter` | 1.05 | 落点在头像上散开多大（× 头像半径） |
| `big` | 1.2 | 子弹飞到终点时放大几倍 |
| `kick` / `kickMax` | 5.7 / 13 | 每颗打中把头像顶多远 px / 抖幅上限 |
| `bounce` | 1.25 | 字弹开的力度 |
| `gravity` | 1.4 | 重力 |
| `linger` | 3000 | 最后一次碰它之后多久开始淡掉 ms |
| `maxBodies` | 90 | 最多几个字当刚体留在地上（多的弹开淡出） |
| `floor` | null | 地板 = 这个元素的底边 |
| `haptics` | true | `navigator.vibrate`，每四颗震一下 |
| `zIndex` | 60 | 画布层级 |

## 接到 AI 那边（可选）

跟[弹弹乐](../avatar-fling/)一样：用户射完再发一条普通用户消息，带标记头、被射的那条消息 id 和原文，给模型一句说明：

```
[companion:machinegun id=1234] Alice把你这句拆成字哒哒哒射你了：「……原文……」
（她长按你这条气泡选了「哒哒哒」，整句拆成字像子弹一样射在你头像上——她可能不喜欢你这句话）
```

反过来，给 AI 一个工具（参数是要射的那条用户消息 id），后端推事件给前端，前端找到那条气泡对着用户的头像 `fire()`，演完再落灰条。

## 原理

- **拆字**：`TreeWalker` 走遍气泡里的文本节点，逐字用 `Range.getBoundingClientRect()` 量出真实排版位置，连字体、粗细、颜色一起记下，所以加粗、换行、混排都能原样拆。emoji 代理对算一个字，空白跳过。
- **空壳**：按气泡真实的四个圆角在离屏 canvas 上画出底色外形，字随发射一个个从上面消失，射完空壳缩没，原气泡从原位弹出来。
- **子弹**：直线飞，带两道残影，越飞越大；落点在头像圆内随机散布。
- **挨打**：欠阻尼弹簧，每颗子弹沿来向给一脚冲量，再压扁一点；抖幅夹在 `kickMax` 里，连射也不会飞出去。
- **地上的字**：matter.js 圆角矩形刚体，地板 + 左右两堵墙；在 document 上抢先接触摸，只有按中字才拖（其余触摸照常滚列表）。
- `prefers-reduced-motion` 时不演，直接 resolve(false)。

## License

MIT
