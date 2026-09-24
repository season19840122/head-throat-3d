/**
 * data.js — 解剖结构元数据
 * 坐标约定：Y 轴向上，+Z 为身体前方（面部朝向），+X 为解剖学右侧。
 * 单位约等于厘米，模型总高约 28 单位。
 *
 * tissue 字段决定使用哪套程序化组织贴图（见 textures.js 的 PRESETS）：
 *   skin / bone / brain / mucosa / mucosaFolded / tongueDorsum / muscle /
 *   cartilage / gland / tooth
 */

export const GROUPS = [
  { id: 'craniofacial', name: '颅面部', icon: '🧠', desc: '骨性外壳与中枢' },
  { id: 'upperAirway', name: '上呼吸道', icon: '👃', desc: '鼻腔 · 口腔 · 咽' },
  { id: 'larynx', name: '喉与声门', icon: '🔊', desc: '发声与气道保护' },
  { id: 'lowerAirway', name: '下呼吸道与毗邻', icon: '🫁', desc: '气管 · 食管 · 腺体' },
  { id: 'softTissue', name: '肌肉与软组织', icon: '💪', desc: '腔壁之外的活体组织' },
  { id: 'context', name: '参照结构', icon: '🦴', desc: '帮助定位' }
];

/**
 * anchor: 标签引线锚点（世界坐标）
 * explode: 爆炸视图位移方向（乘以滑块系数）
 * shell: true 表示属于"外壳层"，剖面模式会被裁剪
 */
export const ORGANS = [
  /* ───────────── 颅面部 ───────────── */
  {
    id: 'skin',
    name: '头部与颈部轮廓',
    en: 'Head & Neck Surface',
    group: 'craniofacial',
    tissue: 'skin',
    // 雕塑质感：暖白石膏、哑光、**不挂任何贴图**。
    // 皮肤贴图会在网格的 V 方向重复十几次，在这块高密度网格上形成一圈圈
    // 肉眼可见的环纹（像等高线），把形体转折彻底吃掉。石料是一整块，
    // 体积要靠明暗读出来，不是靠纹理。
    color: 0xece2d6,
    opacity: 0.42,
    roughness: 0.66,
    bare: true,
    anchor: [0, 21.6, 2.0],
    explode: [0, 6, 0],
    shell: true,
    info: {
      position: '体表投影：颅顶至颈根部。前为面（额、眶、鼻、唇、颏），两侧为耳，后为枕，向下过渡为颈。',
      func: '体表定位的参考系。颈部前方以舌骨、甲状软骨、环状软骨为触诊标志，自上而下依次对应口咽、喉、气管。',
      clinical: '颈部"三骨标志"是急诊气道评估的起点：舌骨平第 3 颈椎，甲状软骨平第 4–5 颈椎，环状软骨平第 6 颈椎（也是喉与气管的分界、咽与食管的分界）。颏下到舌骨的距离还决定了困难气道的插管难度。'
    }
  },
  {
    id: 'skull',
    name: '颅骨',
    en: 'Skull / Calvaria',
    group: 'craniofacial',
    tissue: 'bone',
    color: 0xe9e0cd,
    opacity: 0.30,
    roughness: 0.55,
    anchor: [0, 17.4, -7.6],
    explode: [0, 4, -6],
    shell: true,
    info: {
      position: '颅盖由额骨、顶骨、颞骨、枕骨构成；颅底分前、中、后三个颅窝，前高后低呈阶梯状。面部骨包括上颌骨、颧骨、鼻骨、泪骨等。',
      func: '包裹并保护脑组织；构成鼻腔、口腔、眼眶的骨性支架；颅底各孔是颅神经与血管出入的通道（如卵圆孔→三叉神经下颌支，颈静脉孔→迷走神经）。',
      clinical: '颅底骨折的典型体征：前颅窝骨折 → 脑脊液鼻漏 + "熊猫眼"（Battle 征）；中颅窝骨折 → 脑脊液耳漏；后颅窝骨折 → 乳突后淤斑。颅底是鼻咽癌、脊索瘤等肿瘤向颅内蔓延的通道。'
    }
  },
  {
    id: 'brain',
    name: '脑',
    en: 'Brain',
    group: 'craniofacial',
    tissue: 'brain',
    color: 0xe0a0aa,
    opacity: 1,
    roughness: 0.68,
    anchor: [-3.4, 16.4, 5.6],
    explode: [0, 5, 4],
    info: {
      position: '位于颅腔内，成人重约 1300–1400 g。大脑半球表面凹凸不平：隆起的脑回（gyrus）与凹陷的脑沟（sulcus）；底面贴合前高后低的颅底；后下方为小脑，中间向下延续为脑干。',
      func: '中枢神经系统中枢：大脑皮质负责感觉、运动、语言与认知；小脑维持平衡与协调；脑干内含心血管中枢与呼吸中枢，并有第 III–XII 对颅神经核团。',
      clinical: '呼吸中枢位于延髓与脑桥——这解释了为什么颅脑外伤/脑疝一旦压迫脑干会迅速出现呼吸停止，而高位颈髓损伤（C3 以上）也会因膈肌失神经而呼吸衰竭。小脑扁桃体下疝（Chiari 畸形）可压迫延髓与上颈髓。'
    }
  },
  {
    id: 'mandible',
    name: '下颌骨',
    en: 'Mandible',
    group: 'craniofacial',
    tissue: 'bone',
    color: 0xe9e0cd,
    opacity: 0.55,
    roughness: 0.55,
    anchor: [6.4, 6.4, 5.6],
    explode: [7, -1, 3],
    shell: true,
    info: {
      position: '面部唯一能自由活动的骨。由水平的下颌体与垂直的下颌支构成：下颌体上缘为牙槽突（容纳下牙），下颌支上端有喙突（前）与髁突（后），髁突经颞下颌关节（TMJ）与颞骨相接。',
      func: '咀嚼、说话、吞咽的第一道机械环节；同时通过肌肉张力参与维持上气道开放。下颌骨前伸时舌根随之前移，这正是口腔矫治器的作用原理。',
      clinical: '下颌骨是面部最常骨折的骨之一（仅次于鼻骨），易在颏部、下颌角、髁突颈部三处折断。下颌后缩（小颌畸形）会显著增加阻塞性睡眠呼吸暂停（OSA）风险。下颌关节脱位（"掉下巴"）时髁突滑至关节结节前方，需向下向后复位。'
    }
  },
  {
    id: 'hyoid',
    name: '舌骨',
    en: 'Hyoid Bone',
    group: 'craniofacial',
    tissue: 'bone',
    color: 0xe9e0cd,
    opacity: 0.95,
    roughness: 0.5,
    anchor: [3.4, 4.6, 3.4],
    explode: [4, 0, 3],
    info: {
      position: '颈前正中，舌根下方，约平第 3 颈椎。呈马蹄形（体部 + 大角 + 小角），是全身唯一不与其他骨直接形成关节的骨。',
      func: '舌、咽、喉肌群的共同附着支点。舌骨上肌群（二腹肌、下颌舌骨肌、颏舌骨肌等）上提，舌骨下肌群（胸骨舌骨肌、肩胛舌骨肌等）下降；吞咽与发声时两组协同牵动，完成喉的上提与下降。',
      clinical: '舌骨骨折是扼颈 / 勒颈（strangulation）的重要法医学证据，也是气道悬吊术（舌骨悬吊术）治疗 OSA 的解剖基础。'
    }
  },

  /* ───────────── 上呼吸道 ───────────── */
  {
    id: 'nasalCavity',
    name: '鼻腔',
    en: 'Nasal Cavity',
    group: 'upperAirway',
    tissue: 'mucosa',
    color: 0xa9d4e8,
    opacity: 0.28,
    roughness: 0.3,
    anchor: [2.6, 12.6, 6.0],
    explode: [4, 2, 6],
    shell: true,
    info: {
      position: '鼻中隔两侧的一对腔隙，前经鼻孔通外界，后经鼻后孔（choana）通鼻咽。顶为筛板（嗅神经穿出处），底为硬腭，外侧壁有三个鼻甲。',
      func: '呼吸道的"空调"：加温、加湿、过滤并净化吸入空气；同时是嗅觉感受区、共鸣腔，约占成人总气道阻力的 50%。',
      clinical: '经鼻插管 / 鼻咽通气道之所以能耐受，正是因为鼻腔可被扩张。筛板骨折可致嗅神经撕脱（嗅觉丧失）与脑脊液鼻漏。长期鼻塞会迫使张口呼吸，进而改变下颌发育。'
    }
  },
  {
    id: 'conchae',
    name: '鼻甲',
    en: 'Nasal Conchae',
    group: 'upperAirway',
    tissue: 'mucosa',
    color: 0x8fc6df,
    opacity: 0.9,
    roughness: 0.42,
    anchor: [2.4, 10.1, 3.6],
    explode: [5, 0, 3],
    info: {
      position: '鼻腔外侧壁的三对卷曲黏膜皱襞：上、中、下鼻甲，呈贝壳样向腔内卷曲，下鼻甲最大。各鼻甲下方的缝隙分别称上、中、下鼻道。',
      func: '把鼻腔黏膜面积扩大到约 150 cm²，使气流由湍流转为层流、逐层接触黏膜，从而实现高效加温加湿；同时构成鼻腔的主要阻力来源。中鼻道是鼻窦开口处。',
      clinical: '下鼻甲肥大是慢性鼻塞的主因，也是 OSA 的常见解剖因素。鼻甲手术（如黏膜下切除）须保留黏膜，否则会导致空鼻综合征（ENS）。鼻甲还有"鼻周期"——两侧鼻甲交替充血，每 2–7 小时轮换一次。'
    }
  },
  {
    id: 'nasalSeptum',
    name: '鼻中隔',
    en: 'Nasal Septum',
    group: 'upperAirway',
    tissue: 'cartilage',
    color: 0xd9c9c2,
    opacity: 0.92,
    roughness: 0.4,
    anchor: [0, 11.4, 6.4],
    explode: [0, 3, -3],
    info: {
      position: '居中的垂直隔板，把鼻腔分为左右两半。前部为软骨（鼻中隔软骨），后上部为筛骨垂直板，后下部为犁骨。',
      func: '支撑鼻背外形，并使两侧气流分层、形成层流；表面黏膜是鼻腔加温加湿系统的一部分。',
      clinical: '鼻中隔偏曲极为常见，可致单侧鼻塞、反复鼻出血与打鼾，严重者行鼻中隔矫正术。鼻中隔前下部的 Little 区（Kiesselbach 丛）是鼻出血最常见部位。经蝶窦垂体手术时，鼻中隔是到达蝶窦的自然通道。'
    }
  },
  {
    id: 'sinuses',
    name: '鼻旁窦',
    en: 'Paranasal Sinuses',
    group: 'upperAirway',
    tissue: 'mucosa',
    color: 0xcfe6f2,
    opacity: 0.42,
    roughness: 0.35,
    anchor: [4.4, 14.6, 2.4],
    explode: [6, 3, 0],
    info: {
      position: '额窦、上颌窦、筛窦、蝶窦，共 4 对，均为含气腔，经狭窄的窦口（ostium）开口于鼻腔的中鼻道与上鼻道。',
      func: '减轻颅骨重量、为声音提供共鸣、缓冲面部冲击、协助加温空气。',
      clinical: '上颌窦是鼻窦炎最常累及的窦——因窦口位置高、引流差，脓液易积存；且上颌窦底与上颌磨牙根贴近，牙源性感染可直接蔓延而来。额窦炎可致眶上神经痛；蝶窦炎可波及视神经。'
    }
  },
  {
    id: 'palate',
    name: '硬腭与软腭',
    en: 'Hard & Soft Palate',
    group: 'upperAirway',
    tissue: 'mucosa',
    color: 0xd98f9b,
    opacity: 0.82,
    roughness: 0.42,
    anchor: [-3.0, 7.0, -1.2],
    explode: [-3, 4, -3],
    info: {
      position: '硬腭在前（由上颌骨腭突与腭骨构成，表面有腭皱襞），软腭在后，为可活动的肌性瓣，向后下延伸至游离的悬雍垂（uvula）。',
      func: '分隔鼻腔与口腔。吞咽时软腭上抬、腭咽闭合，封住鼻咽防止食物反流入鼻；发音（除鼻音外）也依赖腭咽闭合。',
      clinical: '软腭过长、过松弛是打鼾与 OSA 的核心机制，故 OSA 手术（如 UPPP）会切除部分软腭与悬雍垂。腭裂是最常见的先天性颅面畸形之一，会同时造成喂养困难（鼻腔反流）、构音障碍与中耳炎（腭帆张肌功能异常）。'
    }
  },
  {
    id: 'oralCavity',
    name: '口腔',
    en: 'Oral Cavity',
    group: 'upperAirway',
    tissue: 'mucosa',
    color: 0xeaa8b0,
    opacity: 0.13,
    roughness: 0.4,
    anchor: [4.4, 7.4, 7.8],
    explode: [4, 1, 6],
    shell: true,
    info: {
      position: '硬腭下方、舌上方，前为唇，两侧为颊，底为口底与舌，后经咽峡（腭舌弓与腭咽弓之间）通口咽。',
      func: '咀嚼与搅拌食物、辅助构音、完成吞咽的口腔期（把食团主动推送至咽部）。唾液在此开始淀粉酶消化并润湿食团。',
      clinical: '口腔期吞咽障碍表现为"食物含在口里咽不下去"，常见于脑卒中与帕金森病。口中含物不清醒是误吸的高危场景。口腔是全身黏膜免疫与消化道入口，口腔溃疡、白斑需警惕癌变。'
    }
  },
  {
    id: 'teethGums',
    name: '牙与牙龈',
    en: 'Teeth & Gingiva',
    group: 'upperAirway',
    tissue: 'tooth',
    color: 0xe4c9bb,
    opacity: 1,
    roughness: 0.4,
    anchor: [3.2, 7.0, 5.6],
    explode: [0, -5, 5],
    info: {
      position: '上、下颌牙槽突上的两列牙齿沿牙弓排列：由前向后依次为切牙（切断）、尖牙（撕裂）、前磨牙与磨牙（研磨）。恒牙共 28–32 颗。牙根埋于牙槽骨内，暴露在口腔的部分为牙冠。',
      func: '咀嚼的机械执行部件；同时参与构音（齿音、唇齿音）与维持面部外形。牙龈覆盖牙槽骨并封闭牙颈，是牙周组织的天然屏障。',
      clinical: '牙周炎是成人失牙的首位原因，且与糖尿病、心血管疾病互相加重。上颌磨牙根与上颌窦底紧邻，拔牙可造成口腔-上颌窦瘘。咽反射与咬合反射是插管与口咽通气道置入时要避开的保护机制。'
    }
  },
  {
    id: 'tongue',
    name: '舌',
    en: 'Tongue',
    group: 'upperAirway',
    tissue: 'tongueDorsum',
    color: 0xcf8590,
    opacity: 1,
    roughness: 0.46,
    anchor: [0, 8.2, 6.4],
    explode: [0, 3, 7],
    info: {
      position: '位于口腔底。由舌内肌（改变舌形）与舌外肌（改变舌位）构成，分舌尖（apex）、舌体（body）、舌根（root）三部。舌背以"V"形界沟（sulcus terminalis）与舌根分界，界沟前方有轮廓乳头，舌背正中线有正中沟；舌腹面有舌系带与舌下阜。',
      func: '搅拌食物并形成食团、把食团推向咽部；舌位决定元音发音；承担味觉（舌前 2/3 由鼓索神经、舌后 1/3 由舌咽神经支配）、温度觉与触觉。舌外肌（颏舌肌）是维持上气道开放的关键肌。',
      clinical: '舌根后坠是昏迷患者气道梗阻最常见的原因，因此急救要用"仰头抬颏法"或放置口咽/鼻咽通气道。舌根也是 OSA 塌陷的关键平面。舌系带过短（舌系带短缩）影响哺乳与发音。舌癌好发于舌侧缘，且淋巴转移率高。'
    }
  },
  {
    id: 'salivaryGlands',
    name: '唾液腺',
    en: 'Salivary Glands',
    group: 'upperAirway',
    tissue: 'gland',
    color: 0xdcc3a6,
    opacity: 0.9,
    roughness: 0.55,
    anchor: [5.6, 6.4, -1.0],
    explode: [8, 0, -3],
    info: {
      position: '大唾液腺三对：腮腺（耳前下方、咬肌表面）、下颌下腺（下颌骨下缘内侧）、舌下腺（口底黏膜下）。',
      func: '分泌唾液，日量约 1–1.5 L。作用包括润湿与溶解食物（便于味觉）、启动淀粉酶消化、清洁口腔、润滑食团以便吞咽，并含免疫球蛋白与溶菌酶参与黏膜防御。',
      clinical: '干燥综合征（Sjögren）与头颈部放疗后放射性口干会导致严重吞咽困难与猖獗龋。下颌下腺导管结石最常见（因导管走行长、开口朝上）。腮腺内有面神经穿行，腮腺手术损伤面神经可致面瘫；流行性腮腺炎即腮腺的病毒性感染。'
    }
  },
  {
    id: 'pharynx',
    name: '咽',
    en: 'Pharynx',
    group: 'upperAirway',
    tissue: 'mucosaFolded',
    color: 0xcd9ad4,
    opacity: 0.30,
    roughness: 0.45,
    anchor: [-4.4, 10.2, -2.6],
    explode: [-5, 0, -4],
    shell: true,
    info: {
      position: '上起颅底、下至第 6 颈椎下缘（环状软骨水平）续于食管，全长约 12 cm。自上而下分为鼻咽、口咽、喉咽三部。鼻咽侧壁有咽鼓管圆枕与咽隐窝；喉咽两侧有梨状隐窝，会厌两侧有会厌谷。',
      func: '呼吸道与消化道的共同通道。吞咽时咽缩肌自上而下依次收缩，把食团推入食管；同时软腭封闭鼻咽、会厌封闭喉口，完成"气道保护"。咽壁黏膜纵褶使其可扩张以容纳食团。',
      clinical: '咽是气道与食道的十字路口，也是吞咽障碍时最易发生误吸的部位。鼻咽癌好发于咽隐窝（Rosenmüller 窝），早期症状常为单侧分泌性中耳炎。咽后脓肿可压迫气道，儿童更凶险。扁桃体位于口咽侧壁的扁桃体窝内，是咽淋巴环的一部分。'
    }
  },
  {
    id: 'muscles',
    name: '咽喉肌群',
    en: 'Pharyngeal & Cervical Muscles',
    group: 'softTissue',
    tissue: 'muscle',
    color: 0xb04f4a,
    opacity: 0.36,
    cover: true,          // 大面积覆盖层：拾取时让位给气管、甲状腺等具体器官
    roughness: 0.6,
    anchor: [-5.4, 1.6, -1.0],
    explode: [-7, 0, 0],
    info: {
      position: '环绕咽与喉的肌肉分为三组：①咽缩肌（上、中、下缩肌，呈叠瓦状自上而下套叠）构成咽后壁与侧壁；②喉外肌与舌骨上/下肌群（二腹肌、下颌舌骨肌、胸骨舌骨肌、胸骨甲状腺肌等）作用于舌骨与喉的位置；③颊肌与翼内肌参与口咽侧壁的封闭。',
      func: '咽缩肌自上而下依次收缩产生蠕动波把食团推入食管（吞咽的咽期核心动作）；舌骨上肌群上提舌骨与喉，既完成吞咽时喉的前上移位，也起到开放上气道的作用。',
      clinical: '咽缩肌与舌骨肌群张力下降是肌少性吞咽障碍与老年性吞咽功能减退的病理基础——这也是"进食训练"（如门德尔松手法、用力吞咽）的靶点。双侧咽缩肌麻痹可见于运动神经元病（ALS）与重症肌无力。'
    }
  },

  /* ───────────── 喉与声门 ───────────── */
  {
    id: 'epiglottis',
    name: '会厌',
    en: 'Epiglottis',
    group: 'larynx',
    tissue: 'cartilage',
    color: 0xe8d489,
    opacity: 0.95,
    roughness: 0.42,
    anchor: [0, 5.8, 3.2],
    explode: [-4, 2, 3],
    info: {
      position: '舌根后下方、喉入口上方的一片树叶状弹性软骨，上缘游离呈叶状并略卷曲，下端变细（会厌柄）经甲状会厌韧带连于甲状软骨内面。表面黏膜在舌根与会厌之间形成会厌谷。',
      func: '吞咽时向后下翻转，盖住喉入口，是防止误吸的"活盖"；同时参与喉内的感觉与反射（喉上神经内支支配），刺激会厌可诱发剧烈的保护性咳嗽。',
      clinical: '急性会厌炎（多由 B 型流感嗜血杆菌引起）可在数小时内使会厌肿胀堵塞气道，是耳鼻喉科最凶险的急症之一——患儿表现为流涎、拒咽、三脚架体位，严禁强行压舌检查。会厌谷与梨状隐窝是异物最常见的隐匿部位。'
    }
  },
  {
    id: 'thyroidCartilage',
    name: '甲状软骨',
    en: 'Thyroid Cartilage',
    group: 'larynx',
    tissue: 'cartilage',
    color: 0xc9dced,
    opacity: 0.62,
    roughness: 0.38,
    anchor: [4.2, 4.4, 2.4],
    explode: [6, 0, 2],
    info: {
      position: '喉最大的软骨：左右两块方形软骨板在前正中线以锐角相接，男性该角约 90°，向前突出形成"喉结"（laryngeal prominence）；女性约 120°，故不明显。板后缘向上伸出上角、向下伸出下角，下角与环状软骨形成环甲关节。',
      func: '构成喉的前壁与侧壁，保护声带；为喉内肌与韧带（包括声韧带、前庭韧带）提供附着。环甲肌牵拉使甲状软骨前倾，从而拉长和绷紧声带，提高音调。',
      clinical: '喉结在青春期受睾酮作用而增大，是男性变声（音调下降约一个八度）的解剖基础。此软骨无内侧骨膜，喉癌易沿此向内侵犯。环甲膜位于甲状软骨下缘与环状软骨上缘之间，是"环甲膜穿刺"的急救入路。'
    }
  },
  {
    id: 'cricoid',
    name: '环状软骨',
    en: 'Cricoid Cartilage',
    group: 'larynx',
    tissue: 'cartilage',
    color: 0xc9dced,
    opacity: 0.85,
    roughness: 0.38,
    anchor: [3.0, 2.0, 0.4],
    explode: [6, -2, 0],
    info: {
      position: '甲状软骨下方，是喉部唯一呈完整环形（似印章戒指）的软骨——后方高而宽的部分为"板"（lamina），前方低而窄的部分为"弓"（arch）。下缘与第一气管环相接，两侧有与甲状软骨下角相扣的关节面。',
      func: '构成气道的刚性支撑，是喉腔下部的完整骨架；杓状软骨坐落于其板上缘，因此环状软骨的倾斜直接影响声带张力。',
      clinical: '正因它是唯一完整的环，"环甲膜穿刺/切开"才选在甲状软骨下缘与环状软骨上缘之间的环甲膜进行。长期气管插管造成的环形狭窄亦多位于此处。环状软骨是"喉与气管、咽与食管"双重分界的体表标志，平第 6 颈椎。'
    }
  },
  {
    id: 'arytenoid',
    name: '杓状软骨与假声带',
    en: 'Arytenoids & Vestibular Folds',
    group: 'larynx',
    tissue: 'cartilage',
    color: 0xd7e6f2,
    opacity: 0.8,
    roughness: 0.4,
    anchor: [1.4, 3.4, -1.0],
    explode: [3, -1, -3],
    info: {
      position: '杓状软骨为一对三棱锥形小软骨，坐落于环状软骨板上缘，是喉内唯一能主动滑移与旋转的软骨。其前方的室襞（假声带/前庭襞）位于声带上方，两者之间为喉室。',
      func: '杓状软骨通过旋转与内收/外展决定声门开闭：环杓后肌外展声带（唯一的开大声门肌，用于呼吸），杓间肌与环杓侧肌内收声带（发声、咳嗽、用力闭气）。假声带内不含肌层，参与喉的保护性括约作用而不直接发声。',
      clinical: '双侧环杓后肌麻痹（如甲状腺术后喉返神经损伤）会造成声门狭窄甚至呼吸困难。杓状软骨脱位是全麻插管后持续性声音嘶哑的常见原因。杓状软骨的滑动是"杓状软骨复位术"的解剖基础。'
    }
  },
  {
    id: 'vocalCords',
    name: '声带',
    en: 'Vocal Cords (Vocal Folds)',
    group: 'larynx',
    tissue: 'mucosa',
    color: 0xf2e2a0,
    opacity: 1,
    roughness: 0.3,
    anchor: [1.6, 3.2, 1.8],
    explode: [3, 0, 4],
    info: {
      position: '喉腔中部，左右各一，由声韧带、声带肌（甲杓肌）与表面黏膜（复层鳞状上皮）构成；两声带之间的裂隙称声门裂（glottis）。前端附着于甲状软骨前正中（前联合），后端附着于杓状软骨声带突。',
      func: '气流通过时两侧声带内收靠拢，受气流冲击产生周期振动（伯努利效应 + 黏膜波），发出基音——成年男性约 100–130 Hz，女性约 200–230 Hz；随后经咽、口、鼻腔共鸣成为嗓音。声带还是下呼吸道的最后一道括约肌，参与咳嗽与用力闭气。',
      clinical: '声带麻痹最常见于喉返神经损伤（甲状腺手术、肺癌/纵隔肿瘤压迫、主动脉瘤）。甲状腺手术有"三大陷阱"：喉返神经、喉上神经外支、甲状旁腺。声带白斑属癌前病变；长期吸烟是喉癌的首要危险因素。声带小结（歌唱者小结）与息肉与用声过度相关。'
    }
  },

  /* ───────────── 下呼吸道与毗邻 ───────────── */
  {
    id: 'trachea',
    name: '气管',
    en: 'Trachea',
    group: 'lowerAirway',
    tissue: 'cartilage',
    color: 0xbcd8ec,
    opacity: 0.72,
    roughness: 0.4,
    anchor: [2.8, -1.4, 1.6],
    explode: [6, -2, 4],
    info: {
      position: '颈前正中，上接环状软骨（约第 6 颈椎），向下入胸腔，于胸骨角平面（T4/T5 椎间盘）分叉为左右主支气管。长 10–12 cm，直径 1.5–2 cm。',
      func: '由 16–20 个"C"形透明软骨环支撑前侧与两侧，后壁为膜性壁（气管肌）——软骨保证气道不塌陷，膜性壁在咳嗽时可内陷，使气流速度骤增至 100 km/h 以上，把异物与痰液高速喷出。黏膜纤毛柱状上皮负责黏液纤毛清除。',
      clinical: '气管切开术常规在第 2–4 气管环之间进行（避开甲状腺峡部与环状软骨，以防术后狭窄）。气道异物更常坠入右主支气管——因为右侧更陡直、管径更大。气管插管深度成人约 21–23 cm（门齿处）。'
    }
  },
  {
    id: 'esophagus',
    name: '食管',
    en: 'Esophagus',
    group: 'lowerAirway',
    tissue: 'mucosaFolded',
    color: 0xe0a98c,
    opacity: 0.56,
    roughness: 0.5,
    anchor: [-3.0, -2.4, -3.6],
    explode: [-6, -2, -5],
    shell: true,
    info: {
      position: '位于气管后方、颈椎前方，上在环状软骨下缘（约第 6 颈椎）续于喉咽，向下经后纵隔、穿膈肌食管裂孔入腹接胃。全长约 25 cm，有 3 处生理性狭窄。黏膜在非进食状态呈纵行皱襞。',
      func: '靠蠕动把食团送入胃。上 1/3 为横纹肌（随意控制，吞咽启动段），中 1/3 为混合肌，下 1/3 为平滑肌；上下两端分别有食管上、下括约肌防止反流与进气。',
      clinical: '3 处生理性狭窄（环咽肌处、主动脉弓与左主支气管交叉处、膈肌食管裂孔处）是异物嵌顿与食管癌的好发部位。胃内容物反流至咽即咽喉反流（LPR），表现为慢性咽异物感、清嗓与声音嘶哑。食管静脉曲张破裂是肝硬化致死性并发症。'
    }
  },
  {
    id: 'thyroidGland',
    name: '甲状腺',
    en: 'Thyroid Gland',
    group: 'lowerAirway',
    tissue: 'gland',
    color: 0xc98b6b,
    opacity: 1,
    roughness: 0.55,
    anchor: [4.4, 0.6, 2.0],
    explode: [7, -1, 5],
    info: {
      position: '气管上段前方、甲状软骨下方，由左右两叶借峡部相连，形似"H"或蝴蝶；约 50% 的人还有向上伸出的锥状叶。表面呈小叶状，血供极为丰富。',
      func: '人体最大的内分泌腺。滤泡细胞分泌 T3/T4，调节全身基础代谢率、产热、生长发育与神经系统兴奋性；滤泡旁 C 细胞分泌降钙素调节血钙。',
      clinical: '甲状腺手术最需保护的三个结构：① 喉返神经（损伤 → 声音嘶哑、误吸）；② 喉上神经外支（损伤 → 高音丢失、发声疲劳）；③ 甲状旁腺（误切 → 低钙抽搐）。气管受压移位是巨大甲状腺肿的典型表现。甲状腺峡部覆盖第 2–4 气管环，故气管切开需避开或切断峡部。'
    }
  },

  /* ───────────── 参照结构 ───────────── */
  {
    id: 'cervicalSpine',
    name: '颈椎',
    en: 'Cervical Spine (C1–C7)',
    group: 'context',
    tissue: 'bone',
    color: 0xe1d9c4,
    opacity: 0.62,
    roughness: 0.55,
    anchor: [0, 2.0, -8.6],
    explode: [0, 0, -7],
    shell: true,
    info: {
      position: '位于气道与食管后方。C1 称寰椎（无椎体，呈环状），C2 称枢椎（有向上突起的齿突），C3–C7 为典型颈椎（椎体较小、有横突孔与椎间孔、棘突分叉）。',
      func: '支撑头部重量（约 5 kg）并保护颈髓。寰枕关节完成点头动作，寰枢关节完成约 50% 的头部左右旋转。C6 横突前结节即颈动脉结节（Chassaignac 结节），可在颈前压向第 6 颈椎止血。',
      clinical: '颈椎过度屈伸伤（whiplash）、颈椎病性脊髓压迫；枢椎齿突骨折或寰枢椎脱位可压迫延髓与高位颈髓而致命。C3 以上的完全性颈髓损伤会因膈肌失神经而需终身呼吸机支持。颈椎前路手术需牵开气管与食管，可致术后吞咽困难。'
    }
  }
];

/** 结构 id → 元数据 */
export const ORG_BY_ID = Object.fromEntries(ORGANS.map(o => [o.id, o]));
