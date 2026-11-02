/**
 * sample-data.js — 首屏示例调查员
 *
 * 这些角色只用于展示数据结构与界面，不会自动写入本地存档。
 * 用户点击「载入示例调查员」后才会调用 storage.characters.save()。
 *
 * 规则口径：克苏鲁的呼唤第七版（CoC 7e）核心规则书
 * - 基础属性：STR/CON/DEX/APP/POW/LUCK = 3D6×5；SIZ/INT/EDU = (2D6+6)×5
 * - 生命值 HP = ⌊(CON+SIZ)/10⌋；魔法值 MP = ⌊POW/5⌋；理智 SAN = POW
 * - 移动力 MOV：STR 与 DEX 均小于 SIZ 时为 7；任一属性 ≥ SIZ 时为 8；两者均大于 SIZ 时为 9
 * - 伤害加值 DB / 体格 Build 由 STR+SIZ 查表
 *
 * 示例角色采用符合规则的静态值，便于直接预览档案结构。
 */

export function createSampleCharacters() {
  const stamp = new Date().toISOString();

  return [
    {
      id: 'pc_sample_lin_moqiu',
      schemaVersion: 1,
      kind: 'pc',
      isSample: true,
      name: '林墨秋',
      age: 28,
      gender: '女',
      occupation: '调查记者',
      occupationId: 'reporter',
      nationality: '中国',
      appearance:
        '短发总被雨打湿，右手虎口有一道旧墨痕。常穿一件洗得发白的风衣，口袋里塞着三支不同颜色的笔。',
      heightCm: 166,
      weightKg: 51,
      personality: ['敏锐', '嘴硬心软', '对真相成瘾', '不擅长道谢'],
      catchphrase: '先别急着下结论。',
      background:
        '曾在上海一家晚报做社会新闻，三年前因追查一起码头失踪案被报社辞退。那篇稿子最终没有刊出，但她一直留着采访本。如今靠给几家小报和私人委托写稿维生，住在虹口一栋漏雨的公寓里。',
      joinReason:
        '失踪者名单上出现了她旧日线人的名字；更重要的是，她想知道三年前那篇稿子究竟被谁压了下去。',
      importantPerson: '陈叔——把她带进报社的老编辑，如今卧病在床，仍替她保管着那本采访笔记。',
      ideology: '真相不该因体面而被埋葬；但如果真相会伤人，至少让人有选择地知道。',
      significantPlace: '十六铺码头旧仓库。她第一次看见不该存在的东西，也是在那里丢掉了记者的工作。',
      treasuredItem: '一支笔帽裂开的派克钢笔，陈叔在她入职第一天送的。',
      traits: '对细节近乎偏执；会在危险面前先掏出笔记本。讨厌被人替她做决定，却总忍不住替别人收拾残局。',
      phobias: '深海恐惧（深水与看不清底的水面）；听见潜水钟声会短暂僵住。',
      motherTongue: '中文',
      languages: [
        { name: '英语', level: 45 },
        { name: '上海话', level: 60 },
      ],
      possessions: [
        '派克钢笔（笔帽有裂痕）',
        '牛皮采访本',
        '柯达折叠相机',
        '老式打火机',
        '一张被水泡过的码头出入证',
        '三块大洋与几张零票',
      ],
      attributes: { str: 45, con: 60, siz: 55, dex: 65, app: 60, int: 70, pow: 55, edu: 80 },
      luck: 55,
      derived: {
        hp: { current: 11, max: 11 },
        mp: { current: 11, max: 11 },
        san: { current: 55, max: 99 },
        mov: 8,
        db: '0',
        build: 0,
      },
      skills: [
        { name: '母语（中文）', base: 80, occupation: 0, interest: 0, total: 80, checked: false },
        { name: '侦查', base: 25, occupation: 35, interest: 0, total: 60, checked: false },
        { name: '图书馆使用', base: 20, occupation: 40, interest: 0, total: 60, checked: false },
        { name: '说服', base: 10, occupation: 25, interest: 0, total: 35, checked: false },
        { name: '心理学', base: 10, occupation: 10, interest: 16, total: 36, checked: false },
        { name: '话术', base: 5, occupation: 10, interest: 0, total: 15, checked: false },
        { name: '摄影', base: 5, occupation: 10, interest: 0, total: 15, checked: false },
        { name: '聆听', base: 20, occupation: 0, interest: 20, total: 40, checked: false },
        { name: '潜行', base: 20, occupation: 0, interest: 10, total: 30, checked: false },
        { name: '急救', base: 30, occupation: 0, interest: 20, total: 50, checked: false },
        { name: '历史', base: 5, occupation: 0, interest: 15, total: 20, checked: false },
        { name: '电子学', base: 1, occupation: 0, interest: 19, total: 20, checked: false },
        { name: '驾驶（汽车）', base: 20, occupation: 0, interest: 20, total: 40, checked: false },
        { name: '博物学', base: 10, occupation: 0, interest: 20, total: 30, checked: false },
        { name: '闪避', base: 32, occupation: 0, interest: 0, total: 32, checked: false },
        { name: '信用评级', base: 0, occupation: 30, interest: 0, total: 30, checked: false },
      ],
      creditRating: 30,
      occupationPoints: 160,
      interestPoints: 140,
      pointsSpent: { occupation: 160, interest: 140 },
      notes: '示例角色 · 可进入车卡工坊直接修改。',
      portrait: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'pc_sample_zhou_yan',
      schemaVersion: 1,
      kind: 'pc',
      isSample: true,
      name: '周砚',
      age: 36,
      gender: '男',
      occupation: '外科医生',
      occupationId: 'doctor',
      nationality: '中国',
      appearance:
        '身形清瘦，戴一副圆框眼镜，白大褂下永远穿着熨得笔挺的衬衫。左手无名指有一道无法完全弯曲的旧伤。',
      heightCm: 178,
      weightKg: 68,
      personality: ['克制', '悲观主义', '习惯性照顾他人', '不信邪但怕黑'],
      catchphrase: '先止血，再谈别的。',
      background:
        '圣玛丽医院夜班外科医生，见过太多无法解释的死亡。三年前的一台手术中，患者在无影灯下说出了一句不属于任何已知语言的话，从此他开始记录那些“医学无法归类”的病例。',
      joinReason:
        '医院地下室新送来的无名尸体，伤口形态与三年前那台手术的病人完全一致；而院方要求他签字火化。',
      importantPerson: '妹妹周棠——在外地读书，是他仅剩的家人，也是他不敢把真相告诉她的人。',
      ideology: '恐惧可以被测量；不能被测量的，只是尚未找到方法。',
      significantPlace: '圣玛丽医院旧楼三层的手术室。那里有一盏从不熄灭的无影灯。',
      treasuredItem: '一枚停在 03:17 的旧怀表，属于三年前死在手术台上的病人。',
      traits: '面对血泊异常冷静，面对空走廊却会反复确认门锁；习惯用医学术语掩盖情绪。',
      phobias: '黑暗中的脚步声（夜晚独处时需开灯）；对“被注视”的偏执。',
      motherTongue: '中文',
      languages: [
        { name: '英语', level: 60 },
        { name: '拉丁语', level: 11 },
      ],
      possessions: [
        '停摆的旧怀表',
        '手术剪（装在皮套里）',
        '圣玛丽医院员工证',
        '手写病例本',
        '一小瓶镇静剂',
        '圆框眼镜与备用镜片',
      ],
      attributes: { str: 50, con: 55, siz: 65, dex: 50, app: 55, int: 75, pow: 60, edu: 85 },
      luck: 45,
      derived: {
        hp: { current: 12, max: 12 },
        mp: { current: 12, max: 12 },
        san: { current: 60, max: 99 },
        mov: 7,
        db: '0',
        build: 0,
      },
      skills: [
        { name: '母语（中文）', base: 85, occupation: 0, interest: 0, total: 85, checked: false },
        { name: '医学', base: 1, occupation: 50, interest: 0, total: 51, checked: false },
        { name: '急救', base: 30, occupation: 30, interest: 0, total: 60, checked: false },
        { name: '心理分析', base: 1, occupation: 20, interest: 0, total: 21, checked: false },
        { name: '生物学', base: 1, occupation: 15, interest: 0, total: 16, checked: false },
        { name: '药剂学', base: 1, occupation: 10, interest: 0, total: 11, checked: false },
        { name: '拉丁语', base: 1, occupation: 5, interest: 0, total: 6, checked: false },
        { name: '信用评级', base: 0, occupation: 40, interest: 0, total: 40, checked: false },
        { name: '侦查', base: 25, occupation: 0, interest: 40, total: 65, checked: false },
        { name: '聆听', base: 20, occupation: 0, interest: 30, total: 50, checked: false },
        { name: '说服', base: 10, occupation: 0, interest: 25, total: 35, checked: false },
        { name: '心理学', base: 10, occupation: 0, interest: 20, total: 30, checked: false },
        { name: '历史', base: 5, occupation: 0, interest: 15, total: 20, checked: false },
        { name: '驾驶（汽车）', base: 20, occupation: 0, interest: 10, total: 30, checked: false },
        { name: '潜行', base: 20, occupation: 0, interest: 10, total: 30, checked: false },
        { name: '闪避', base: 25, occupation: 0, interest: 0, total: 25, checked: false },
      ],
      creditRating: 40,
      occupationPoints: 170,
      interestPoints: 150,
      pointsSpent: { occupation: 170, interest: 150 },
      notes: '示例角色 · 可进入车卡工坊直接修改。',
      portrait: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
}
