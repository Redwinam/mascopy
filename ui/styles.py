"""UI样式定义"""

STYLE_SHEET = """
QMainWindow {
    background-color: #f5f5f5;
}

QDialog {
    background-color: #f5f5f5;
}

QLabel {
    color: #333333;
}

QPushButton {
    background-color: #2196F3;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    font-weight: bold;
}

QPushButton:hover {
    background-color: #1976D2;
}

QPushButton:disabled {
    background-color: #BDBDBD;
}

QPushButton#cancelButton {
    background-color: #F44336;
}

QPushButton#cancelButton:hover {
    background-color: #D32F2F;
}

QPushButton#pauseButton {
    background-color: #FF9800;
}

QPushButton#pauseButton:hover {
    background-color: #F57C00;
}

QPushButton#startButton {
    background-color: #4CAF50;
}

QPushButton#startButton:hover {
    background-color: #388E3C;
}

QProgressBar {
    border: 2px solid #E0E0E0;
    border-radius: 4px;
    text-align: center;
    background-color: #FFFFFF;
}

QProgressBar::chunk {
    background-color: #2196F3;
    border-radius: 2px;
}

QTextEdit {
    border: 2px solid #E0E0E0;
    border-radius: 4px;
    padding: 8px;
    background-color: #FFFFFF;
    font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
}

QCheckBox {
    color: #333333;
}

QCheckBox::indicator {
    width: 18px;
    height: 18px;
}

QGroupBox {
    border: 2px solid #E0E0E0;
    border-radius: 4px;
    margin-top: 12px;
    padding-top: 16px;
    background-color: #FFFFFF;
}

QGroupBox::title {
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 5px;
    color: #333333;
    font-weight: bold;
}

QTableWidget {
    border: 2px solid #E0E0E0;
    border-radius: 4px;
    background-color: #FFFFFF;
    gridline-color: #E0E0E0;
    color: #333333;
}

QTableWidget::item {
    padding: 8px;
    color: #333333;
}

QTableWidget::item:selected {
    background-color: #E3F2FD;
    color: #1976D2;
}

QHeaderView::section {
    background-color: #F5F5F5;
    padding: 8px;
    border: none;
    border-bottom: 2px solid #E0E0E0;
    font-weight: bold;
    color: #333333;
}

QTabWidget::pane {
    border: 2px solid #E0E0E0;
    border-radius: 4px;
    background-color: #FFFFFF;
}

QTabBar::tab {
    background-color: #F5F5F5;
    border: 2px solid #E0E0E0;
    border-bottom: none;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    padding: 8px 16px;
    margin-right: 2px;
    color: #333333;
}

QTabBar::tab:selected {
    background-color: #FFFFFF;
    border-bottom: none;
    margin-bottom: -2px;
    color: #1976D2;
    font-weight: bold;
}

QTabBar::tab:hover {
    background-color: #E3F2FD;
}
""" 