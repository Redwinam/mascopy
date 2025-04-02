"""UI样式定义 - 现代简约风格"""

STYLE_SHEET = """
/* 全局样式 */
QMainWindow, QDialog {
    background-color: #F8F9FA;  /* 更柔和的背景色 */
    font-family: "Segoe UI", "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* 移除所有控件的焦点矩形 */
*::focus {
    outline: none;
}
*::focus-rect {
    outline: none;
    border: none;
}

/* 标签样式 */
QLabel {
    color: #212529;
    font-size: 13px;
}

/* 按钮样式 */
QPushButton {
    background-color: #4361EE;  /* 现代蓝色 */
    color: white;
    border: none;
    padding: 4px 16px;
    border-radius: 6px;
    font-weight: bold;
    font-size: 13px;
    min-height: 36px;
    outline: none;
    text-decoration: none;
}

QPushButton:focus {
    outline: none;
    border: none;
}

QPushButton::focus-rect {
    border: none;
    outline: none;
}

QPushButton:hover {
    background-color: #3A56D4;
    outline: none;
    border: none;
}

QPushButton:pressed {
    background-color: #2B44B8;
    outline: none;
    border: none;
}

QPushButton:disabled {
    background-color: #CFD2D9;
    color: #909090;
    outline: none;
    border: none;
}

/* 使特定按钮的样式更加明确 */
QPushButton#startButton, QPushButton#cancelButton, QPushButton#pauseButton {
    border: none;
    outline: none;
    text-decoration: none;
}

QPushButton#startButton {
    background-color: #4CAF50; /* 绿色 */
    color: white;
    font-size: 14px;
}

QPushButton#startButton:hover {
    background-color: #43A047;
}

QPushButton#startButton:pressed {
    background-color: #388E3C;
}

QPushButton#cancelButton {
    background-color: #F44336; /* 红色 */
    color: white;
}

QPushButton#cancelButton:hover {
    background-color: #E53935;
}

QPushButton#cancelButton:pressed {
    background-color: #D32F2F;
}

QPushButton#pauseButton {
    background-color: #FF9800; /* 橙色 */
    color: white;
}

QPushButton#pauseButton:hover {
    background-color: #FB8C00;
}

QPushButton#pauseButton:pressed {
    background-color: #F57C00;
}

/* 进度条样式 */
QProgressBar {
    border: none;
    border-radius: 8px;
    background-color: #EAEEF2;
    text-align: center;
    color: #212529;
    font-weight: bold;
    margin: 2px;
    height: 14px;
    padding: 0px;
}

QProgressBar::chunk {
    background-color: qlineargradient(spread:pad, x1:0, y1:0, x2:1, y2:0, 
                                      stop:0 #4361EE, stop:1 #3A56D4);
    border-radius: 8px;
}

/* 文本编辑区域样式 */
QTextEdit {
    border: 2px solid #DEE2E6;
    border-radius: 8px;
    padding: 12px;
    background-color: #FFFFFF;
    font-family: "Menlo", "Courier New", "Monaco", "DejaVu Sans Mono";
    color: #212529;
    line-height: 1.5;
    selection-background-color: #CED4DA;
}

/* 复选框样式 */
QCheckBox {
    color: #212529;
    font-size: 13px;
    padding: 4px;
    spacing: 8px;
}

QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 2px solid #CED4DA;
}

QCheckBox::indicator:checked {
    background-color: #4361EE;
    border: 2px solid #4361EE;
    image: url(check.png);  /* 如果有图标的话 */
}

QCheckBox::indicator:hover {
    border: 2px solid #4361EE;
}

/* 分组框样式 */
QGroupBox {
    border: 2px solid #DEE2E6;
    border-radius: 10px;
    margin-top: 16px;
    padding-top: 24px;
    background-color: #FFFFFF;
    font-weight: bold;
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    left: 16px;
    top: 8px;
    color: #4361EE;
    padding: 0 6px;
    background-color: #FFFFFF;
    font-size: 14px;
}

/* 表格样式 */
QTableWidget {
    border: 2px solid #DEE2E6;
    border-radius: 10px;
    background-color: #FFFFFF;
    gridline-color: #E9ECEF;
    alternate-background-color: #F8F9FA;
    selection-background-color: #E9ECEF;
}

QTableWidget::item {
    padding: 8px;
    border-bottom: 1px solid #E9ECEF;
}

QTableWidget::item:selected {
    background-color: #E7F5FF;
    color: #212529;
}

QTableWidget::item:hover {
    background-color: #F1F3F5;
}

QHeaderView::section {
    background-color: #F1F3F5;
    padding: 10px;
    border: none;
    border-right: 1px solid #DEE2E6;
    border-bottom: 2px solid #4361EE;
    font-weight: bold;
    color: #495057;
    font-size: 13px;
}

QHeaderView::section:first {
    border-top-left-radius: 8px;
}

QHeaderView::section:last {
    border-right: none;
    border-top-right-radius: 8px;
}

/* 标签页样式 */
QTabWidget::pane {
    border: 2px solid #DEE2E6;
    border-radius: 10px;
    background-color: #FFFFFF;
    top: -2px;
}

QTabBar::tab {
    background-color: #E9ECEF;
    border: 2px solid #DEE2E6;
    border-bottom: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    padding: 10px 16px;
    margin-right: 4px;
    color: #495057;
    font-weight: 500;
    min-width: 80px;
}

QTabBar::tab:selected {
    background-color: #FFFFFF;
    border-bottom: none;
    margin-bottom: -2px;
    color: #4361EE;
    font-weight: bold;
    border-top: 3px solid #4361EE;
}

QTabBar::tab:hover:!selected {
    background-color: #F1F3F5;
}

/* 滚动条样式 */
QScrollBar:vertical {
    border: none;
    background-color: #F1F3F5;
    width: 12px;
    margin: 12px 0 12px 0;
    border-radius: 6px;
}

QScrollBar::handle:vertical {
    background-color: #CED4DA;
    min-height: 30px;
    border-radius: 5px;
}

QScrollBar::handle:vertical:hover {
    background-color: #ADB5BD;
}

QScrollBar::handle:vertical:pressed {
    background-color: #868E96;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    border: none;
    background: none;
    height: 12px;
}

QScrollBar:horizontal {
    border: none;
    background-color: #F1F3F5;
    height: 12px;
    margin: 0 12px 0 12px;
    border-radius: 6px;
}

QScrollBar::handle:horizontal {
    background-color: #CED4DA;
    min-width: 30px;
    border-radius: 5px;
}

QScrollBar::handle:horizontal:hover {
    background-color: #ADB5BD;
}

QScrollBar::handle:horizontal:pressed {
    background-color: #868E96;
}

QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
    border: none;
    background: none;
    width: 12px;
}

/* 文件选择框样式 */
QFileDialog {
    background-color: #F8F9FA;
}

QFileDialog QListView, QFileDialog QTreeView {
    background-color: #FFFFFF;
    border: 2px solid #DEE2E6;
    border-radius: 8px;
}

QFileDialog QPushButton {
    min-width: 80px;
}
""" 