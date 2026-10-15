# 河豚 · avatar-puff

长按聊天里自己的头像，它像河豚一样分几口气鼓成两倍大；鼓着的时候，之后每条消息的头像都一样大。再长按一下，它像撒了气的气球，晃两下、一边乱窜一边缩成一个点，然后从原位"啵"地冒回来。用来表示「看我看我」：撒娇、要抱抱、闹别扭都行。

零依赖，一个 JS 文件，手机触摸和电脑鼠标都能玩。

Long-press your own chat avatar and it puffs up like a pufferfish, a few breaths at a time. Long-press again and it deflates like a balloon, zipping around as it shrinks to a dot, then pops back in place. Zero dependencies, touch + mouse.

**Demo**：[zziying.github.io/fidgets/avatar-puff](https://zziying.github.io/fidgets/avatar-puff/)（手机上最好玩），或者直接打开 `index.html`。

## 用法

```html
<script src="avatar-puff.js"></script>
<script>
  const puff = AvatarPuff.attach({
    container: document.querySelector(".chat"),  // 装消息的滚动容器
    side: "me",                                   // 名字：决定 CSS 变量 --ap-me 和 class .ap-me / .puffed-me
    row: ".msg.me",                               // 这一侧的消息行
    anyRow: ".msg",                               // 所有消息行（两侧都算）
    avatar: ".avatar",                            // 行里的头像元素
    onChange(on, byUser) {},                      // 鼓起来 / 瘪回去（瘪是撒气演完才回调）
  });

  puff.on(); puff.off(); puff.toggle(); puff.isOn;
  puff.set(true);   // 直接跳到某个状态，不演动画、不回调（刷新页面后恢复用）
  puff.destroy();
</script>
```

对方的头像也可以鼓：再 `attach` 一个 `side: "them"`、`gesture: false` 的实例，由你的代码调 `on()` / `off()`。

## 布局要你自己写（这是故意的）

头像变大会碰到聊天页的布局：它要不要挤开气泡？对面的气泡会不会伸到它那一列？行高要不要变？每个聊天页的答案都不一样，所以库**不碰尺寸**，只负责手势、状态和动画，往外给这几样：

| 给出来的 | 在哪 | 意思 |
|---|---|---|
| `--ap-me` | `container` 上的 CSS 变量 | 当前倍率，1 → `scale`，吹气时一口一口往上涨 |
| `.ap-me` | 消息行上的 class | 从鼓起来那一组开始、往后所有的行（两侧都有，鼓着时新来的行也会自动加上） |
| `.puffed-me` | `container` 上的 class | 鼓着 |
| `--ap-ms` | `container` 上的 CSS 变量 | 吹气时每口气的时长，把它接进你的 `transition` 里，涨起来才会一顿一顿的 |

两种写法，demo 底下的「布局」按钮可以来回切：

**覆盖**（最省事，零布局影响，代价是会盖住旁边的字）：

```css
.msg.me.ap-me .avatar{ scale: var(--ap-me, 1); transform-origin: 100% 100%; transition: scale var(--ap-ms, .45s); }
```

**让位**（头像那一列整体变宽、头往上长不撑高行，对面的气泡让出这一列）：

```css
.avatar{ transition: width var(--ap-ms, .45s), height var(--ap-ms, .45s), margin var(--ap-ms, .45s); }
.msg.me.ap-me .avatar{
  width:  calc(var(--avatar) * var(--ap-me, 1));
  height: calc(var(--avatar) * var(--ap-me, 1));
  margin-top: calc(var(--avatar) * (1 - var(--ap-me, 1)));   /* 往上长，行高不变 */
}
.msg.them.ap-me{ max-width: calc(82% - var(--avatar) * (var(--ap-me, 1) - 1)); }   /* 对面让出这一列 */
```

只在 `.ap-me` 的行上生效，所以鼓起来之前的历史消息一行都不会动，不会因为重新折行让页面跳。

吹气挤一下、撒气、冒回这三个动画是库自己注入的 `transform` keyframes（`.ap-breath` / `.ap-off` / `.ap-pop`），叠在你的尺寸之上，不冲突。

### 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `scale` | 1.96 | 鼓起来是常态的几倍 |
| `press` | 400 | 长按多少 ms 触发（按住到点就触发，不用等松手） |
| `moveTolerance` | 8 | 手指挪动超过多少 px 取消长按（滚动也会取消） |
| `gesture` | true | false = 不绑手势，只能代码调 |
| `latestOnly` | true | 只有这一侧最新的那颗头像响应长按 |
| `breaths` | 4 | 分几口气吹到位（第一口最大，后面递减） |
| `breathMs` | 230 | 每口气多久 |
| `offMs` | 620 | 撒气动画时长 |
| `gapMs` | 420 | 缩没了之后多久冒回来 |
| `haptics` | true | `navigator.vibrate` 震一下 |

## 接到 AI 那边（可选）

跟[弹弹乐](../avatar-fling/)一样的套路：用户鼓/瘪时发一条普通用户消息，带一个可解析的标记头 + 一句人话 + 一句给模型的说明：

```
[companion:puff on] Alice的头像鼓起来了
（她在聊天里长按自己的头像，头像鼓成两倍大——这是「看我看我」的信号：撒娇、要抱抱、想被注意，不一定是生气。头像小特效）
```

前端把这条渲染成居中灰条，不当气泡。如果你的消息是从后端重新拉的，鼓着的状态最好也从消息流里推导：按顺序扫 `[companion:puff on/off]`，最后一条是 on 就是鼓着，刷新页面后用 `set(true)` 直接到位、不重演吹气。AI 那边给一个 `puff` 工具（`target`、`on`），后端推一个事件，前端调对应实例的 `on()` / `off()`。

## 原理

- **吹气**：倍率按 `1 − (1 − i/n)^1.6` 分 n 口气写进 CSS 变量，第一口最大、后面越来越小；每口气的同时头像 `scale(1.07, .93)` 挤一下，像真被吹进一口气。过渡时长在吹气期间换成每口气的时长，一顿一顿的。
- **撒气**：先挤两下，然后一边转一边往上乱窜、缩成一个点（`both` 停在 0），演完才把 class 和变量撤掉、让布局收回去，隔 `gapMs` 再从原位 `scale(0 → 1)` 带 overshoot 弹出来。
- **起点**：从最新那颗头像所在的一整组（往上连续同一侧的行）开始打 class，这样整组气泡的右边缘是对齐的，不会只有最后一条被挤开。
- `prefers-reduced-motion` 时直接到位，不演动画，回调照发。

## License

MIT
