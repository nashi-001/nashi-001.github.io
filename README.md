# 漢字練習アプリ - 常用漢字2136

常用漢字2136字を学年別に練習できるウェブアプリケーションです。
成績に基づいた優先度付きの出題アルゴリズムと、手書きキャンバス機能を備えています。

## アプリケーションフロー (Flowchart)

```mermaid
graph TD
    Start((開始)) --> GradeSelect[学年選択画面]
    GradeSelect --> |学年を選択して開始| PracticeInit{練習初期化}
    
    subgraph "練習ルーチン (DAILY_PRACTICE_COUNT=10)"
        PracticeInit --> SelectKanji[成績に基づき漢字を選択]
        SelectKanji --> LoadQ[問題読み込み: 例文・読み・漢字]
        LoadQ --> Canvas[手書きキャンバス表示]
        Canvas --> Reveal{タップで漢字表示/非表示}
        Reveal --> |書き取り| Action[成否判定ボタン]
        Action --> |成功/失敗| Record[成績をlocalStorageに記録]
        Record --> Next{次があるか?}
        Next --> |Yes| LoadQ
    end

    Next --> |No| Complete[完了画面]
    Complete --> |もう一度| PracticeInit
    Complete --> |戻る| GradeSelect

    GradeSelect --> |統計ボタン| Stats[統計画面]
    Stats --> |戻る| GradeSelect
    
    subgraph "出題優先度ロジック"
        Priority[優先度計算]
        Priority --> P1[最近失敗した: 95]
        Priority --> P2[3日間の成績不良: 90]
        Priority --> P3[未学習: 80]
        Priority --> P4[1週間の成績不良: 70]
        Priority --> P5[マスター済: 5]
    end
```

## 主な機能

- **学年別選択**: 小学校1年〜6年、および中学・高校の常用漢字を網羅。
- **インテリジェント出題**: 
    - `localStorage`に保存された過去の正解・不正解履歴から優先度を計算。
    - 苦手な漢字や未学習の漢字を優先的に出題。
    - 1週間ミスがない漢字は「習得済」として優先度を下げ、効率的な学習を支援。
- **手書きキャンバス**: マウスやタッチ操作で漢字を実際に書いて練習可能。
- **統計表示**: 学年ごとの習得率や、漢字ごとの詳細な成績を確認可能。

## 技術スタック

- **Frontend**: HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Storage**: Browser LocalStorage
- **Design**: Google Fonts (Noto Sans JP, Zen Maru Gothic)
