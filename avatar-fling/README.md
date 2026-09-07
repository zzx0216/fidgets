# 弹弹乐 · avatar-fling

拽住聊天里对方的头像，它会像果冻一样被揪出来一坨；轻轻拉一下松手，弹回去；拉过一条线松手，整颗头像被弹弓甩出屏幕，在上下边弹几下滚出去，半秒后从原位冒回来。也可以反过来：调一个方法，让"对方"把你弹飞。

零依赖，一个 JS 文件，手机触摸和电脑鼠标都能玩。

Grab a chat avatar, stretch it like jelly, let go: it snaps back, or gets slingshotted off-screen with bouncy ball physics and pops back in place. Zero dependencies, touch + mouse.

**Demo**：[zziying.github.io/fidgets/avatar-fling](https://zziying.github.io/fidgets/avatar-fling/)（手机上最好玩），或者直接打开 `index.html`。

## 用法

```html
<script src="avatar-fling.js"></script>
<script>
  const fling = AvatarFling.attach({
    container: document.querySelector(".chat"),  // 装消息的滚动容器
    row: ".msg.them",                             // 哪些行的头像可以被拽
    avatar: ".avatar",                            // 行里的头像元素（圆的；img 或 background-image 都行）
    bubble: ".bubble",                            // 行里没头像时 flingAway() 改拽这个
    onPull(n) {},                                 // 拉了没过线、弹回去了（n = 1.2 秒内攒的次数）
    onFly(n)  {},                                 // 过线弹飞了
  });

  fling.flingAway(row);   // 对方弹你：一只看不见的手拽住这行的头像（没头像就拽气泡）甩出去。row 不传 = 最后一行
  fling.destroy();
</script>
```

给头像元素加上 `touch-action: none`，iOS 上手势更稳（库里也有兜底）。

### 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `flyAt` | 150 | 手指原始位移超过多少 px 松手算弹飞 |
| `rubber` | 150 | 橡皮筋：显示位移 = R·(1 − 1/(1 + d/R))，渐近 R |
| `batchMs` | 1200 | 连拽合并上报的时间窗 |
| `dimMax` | 0.62 | 拉伸时页面暗幕最深多少 |
| `bg` | body 背景色 | 垫在原位盖住真头像的圆盘颜色 |
| `haptics` | true | `navigator.vibrate` 震一下 |
| `fallbackFill` | `#5b6f80` | 取不到头像平均色时的果冻色 |

## 原理

- **果冻**：一张全屏 `<svg>` 叠层，本体圆 + 揪出来的小圆 + 中间一条掐腰的"脖子" path，套一个 `feGaussianBlur` → `feColorMatrix`（alpha 18/−7）的 goo 滤镜，接缝就融成一团。头像本身用 `clipPath` 圆裁剪贴在本体上，跟着走。
- **颜色**：把头像画到 16×16 的 canvas 上取平均色，提一点亮，就是果冻的颜色（跨域图片 canvas 会污染，回落到默认色）。
- **橡皮筋**：手指位移过一个渐近函数，拉得越远越费劲。
- **弹回**：简单弹簧（stiffness 220 / damping 11）带 overshoot。
- **弹飞**：那坨先在 150ms 内缩回本体，然后整颗按松手方向出手；上下是墙（反弹系数 0.72、每次撞墙震 8ms），左右开放，带重力；总往对面半边飞，不然朝近墙出手一下就没了。
- **冒回**：飞出去 520ms 后真头像从原位 `scale(0) → 1` 弹出来。
- 一开始拖动就把真头像 `visibility:hidden`，叠层最底垫一枚页面底色的圆盘盖住原位，防止真机上隐藏慢半拍露出双影。
- `prefers-reduced-motion` 时不画动画，回调照发。

灵感来自各种 liquid / gooey 效果的 SVG 滤镜玩法。

## License

MIT
