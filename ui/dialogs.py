"""对话框类定义"""

from PyQt6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
                            QProgressBar, QDialogButtonBox, QTableWidget,
                            QTableWidgetItem, QHeaderView, QTabWidget,
                            QWidget, QGroupBox, QFrame, QPushButton)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont, QColor

from .styles import STYLE_SHEET

class ScanProgressDialog(QDialog):
    """扫描进度对话框"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('扫描进度')
        self.setGeometry(300, 300, 500, 150)
        self.setModal(True)
        self.setStyleSheet(STYLE_SHEET)
        
        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.setContentsMargins(20, 20, 20, 20)
        
        # 进度标签
        self.status_label = QLabel("正在扫描文件...")
        self.status_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(self.status_label)
        
        # 当前文件标签
        self.file_label = QLabel("")
        self.file_label.setWordWrap(True)
        self.file_label.setStyleSheet("color: #666666;")
        layout.addWidget(self.file_label)
        
        # 进度条
        self.progress_bar = QProgressBar()
        self.progress_bar.setMinimumHeight(20)
        layout.addWidget(self.progress_bar)
        
        # 取消按钮
        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)
        
        self.setLayout(layout)
    
    def update_progress(self, current, total, message):
        """更新进度状态"""
        if total > 0:
            percentage = int((current / total) * 100)
            self.progress_bar.setValue(percentage)
        
        self.file_label.setText(message)


class ScanResultDialog(QDialog):
    """预扫描结果对话框"""
    start_upload_signal = pyqtSignal(list)  # 开始上传的信号
    
    def __init__(self, scan_results, parent=None):
        super().__init__(parent)
        self.scan_results = scan_results
        self.files = scan_results["files"]
        self.stats = scan_results["stats"]
        self.setStyleSheet(STYLE_SHEET)
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('预扫描结果')
        self.setGeometry(100, 100, 900, 600)
        
        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.setContentsMargins(20, 20, 20, 20)
        
        # 添加统计信息
        stats_box = QGroupBox("统计信息")
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(20)
        stats_layout.setContentsMargins(15, 15, 15, 15)
        
        # 创建统计卡片
        stats_cards = [
            ("总文件数", self.stats['total'], "#2196F3"),
            ("将上传", self.stats['upload'], "#4CAF50"),
            ("将覆盖", self.stats['overwrite'], "#FF9800"),
            ("将跳过", self.stats['skip'], "#9E9E9E")
        ]
        
        for title, value, color in stats_cards:
            card = QFrame()
            card.setFrameStyle(QFrame.Shape.StyledPanel | QFrame.Shadow.Raised)
            card.setStyleSheet(f"""
                QFrame {{
                    background-color: {color};
                    border-radius: 8px;
                    padding: 10px;
                }}
            """)
            card_layout = QVBoxLayout()
            card_layout.setSpacing(5)
            
            value_label = QLabel(str(value))
            value_label.setStyleSheet("""
                QLabel {
                    color: white;
                    font-size: 24px;
                    font-weight: bold;
                }
            """)
            
            title_label = QLabel(title)
            title_label.setStyleSheet("""
                QLabel {
                    color: white;
                    font-size: 14px;
                }
            """)
            
            card_layout.addWidget(value_label, alignment=Qt.AlignmentFlag.AlignCenter)
            card_layout.addWidget(title_label, alignment=Qt.AlignmentFlag.AlignCenter)
            card.setLayout(card_layout)
            
            stats_layout.addWidget(card)
        
        stats_box.setLayout(stats_layout)
        layout.addWidget(stats_box)
        
        # 创建标签页用于显示不同状态的文件
        tab_widget = QTabWidget()
        
        # 所有文件
        all_files_tab = QWidget()
        all_files_layout = QVBoxLayout()
        all_files_layout.setContentsMargins(0, 10, 0, 0)
        all_files_table = self.create_file_table(self.files)
        all_files_layout.addWidget(all_files_table)
        all_files_tab.setLayout(all_files_layout)
        tab_widget.addTab(all_files_tab, f"所有文件 ({self.stats['total']})")
        
        # 将上传
        upload_files = [f for f in self.files if f.status == "将上传"]
        upload_tab = QWidget()
        upload_layout = QVBoxLayout()
        upload_layout.setContentsMargins(0, 10, 0, 0)
        upload_table = self.create_file_table(upload_files)
        upload_layout.addWidget(upload_table)
        upload_tab.setLayout(upload_layout)
        tab_widget.addTab(upload_tab, f"将上传 ({self.stats['upload']})")
        
        # 将覆盖
        overwrite_files = [f for f in self.files if f.status == "将覆盖"]
        overwrite_tab = QWidget()
        overwrite_layout = QVBoxLayout()
        overwrite_layout.setContentsMargins(0, 10, 0, 0)
        overwrite_table = self.create_file_table(overwrite_files)
        overwrite_layout.addWidget(overwrite_table)
        overwrite_tab.setLayout(overwrite_layout)
        tab_widget.addTab(overwrite_tab, f"将覆盖 ({self.stats['overwrite']})")
        
        # 将跳过
        skip_files = [f for f in self.files if f.status == "将跳过"]
        skip_tab = QWidget()
        skip_layout = QVBoxLayout()
        skip_layout.setContentsMargins(0, 10, 0, 0)
        skip_table = self.create_file_table(skip_files)
        skip_layout.addWidget(skip_table)
        skip_tab.setLayout(skip_layout)
        tab_widget.addTab(skip_tab, f"将跳过 ({self.stats['skip']})")
        
        layout.addWidget(tab_widget)
        
        # 底部按钮
        buttons_layout = QHBoxLayout()
        buttons_layout.setSpacing(10)
        
        self.start_btn = QPushButton('开始上传')
        self.start_btn.setObjectName("startButton")
        self.start_btn.clicked.connect(self.start_upload)
        self.cancel_btn = QPushButton('取消')
        self.cancel_btn.setObjectName("cancelButton")
        self.cancel_btn.clicked.connect(self.reject)
        
        # 设置按钮大小
        self.start_btn.setMinimumHeight(40)
        self.cancel_btn.setMinimumHeight(40)
        
        buttons_layout.addStretch(1)
        buttons_layout.addWidget(self.cancel_btn)
        buttons_layout.addWidget(self.start_btn)
        
        layout.addLayout(buttons_layout)
        
        self.setLayout(layout)
    
    def create_file_table(self, files):
        """创建文件表格"""
        table = QTableWidget()
        table.setColumnCount(5)
        table.setRowCount(len(files))
        
        headers = ["文件名", "类型", "大小", "拍摄日期", "状态"]
        table.setHorizontalHeaderLabels(headers)
        
        # 调整表格外观
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for i in range(1, 4):  # 前4列自适应内容
            table.horizontalHeader().setSectionResizeMode(i, QHeaderView.ResizeMode.ResizeToContents)
        
        # 设置状态列的固定宽度
        table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        table.setColumnWidth(4, 120)  # 设置第5列宽度为120像素
        
        # 设置行高
        table.verticalHeader().setDefaultSectionSize(40)  # 设置默认行高为40像素
        
        # 强制设置表格样式
        table.setStyleSheet("""
            QTableWidget {
                border: 2px solid #E0E0E0;
                border-radius: 4px;
                background-color: #FFFFFF;
                gridline-color: #E0E0E0;
            }
            QTableWidget::item {
                padding: 8px;
                color: #333333;
            }
            QTableWidget::item:selected {
                background-color: #E3F2FD;
                color: #1976D2;
            }
        """)
        
        for i, file in enumerate(files):
            # 文件名
            name_item = QTableWidgetItem(file.filename)
            table.setItem(i, 0, name_item)
            
            # 类型
            type_item = QTableWidgetItem(file.file_type)
            table.setItem(i, 1, type_item)
            
            # 大小 (转换为更友好的格式)
            size_str = self.format_size(file.file_size)
            size_item = QTableWidgetItem(size_str)
            table.setItem(i, 2, size_item)
            
            # 日期
            date_str = file.date.strftime('%Y-%m-%d %H:%M:%S')
            date_item = QTableWidgetItem(date_str)
            table.setItem(i, 3, date_item)
            
            # 状态 - 创建自定义的标签来显示状态
            status_cell = QWidget()
            status_layout = QHBoxLayout(status_cell)
            status_layout.setContentsMargins(4, 2, 4, 2)
            
            if file.status == "将上传":
                status_label = QLabel("将上传")
                status_label.setStyleSheet("""
                    color: white;
                    background-color: #4CAF50; 
                    border-radius: 4px;
                    padding: 5px 10px;
                    font-weight: bold;
                    font-size: 12px;
                    min-width: 60px;
                    min-height: 20px;
                    text-align: center;
                """)
            elif file.status == "将覆盖":
                status_label = QLabel("将覆盖")
                status_label.setStyleSheet("""
                    color: white;
                    background-color: #FF9800; 
                    border-radius: 4px;
                    padding: 5px 10px;
                    font-weight: bold;
                    font-size: 12px;
                    min-width: 60px;
                    min-height: 20px;
                    text-align: center;
                """)
            elif file.status == "将跳过":
                status_label = QLabel("将跳过")
                status_label.setStyleSheet("""
                    color: white;
                    background-color: #9E9E9E; 
                    border-radius: 4px;
                    padding: 5px 10px;
                    font-weight: bold;
                    font-size: 12px;
                    min-width: 60px;
                    min-height: 20px;
                    text-align: center;
                """)
            else:
                status_label = QLabel(file.status)
            
            # 设置标签文本居中
            status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            
            status_layout.addWidget(status_label)
            status_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            table.setCellWidget(i, 4, status_cell)
        
        return table
    
    def format_size(self, size_bytes):
        """格式化文件大小"""
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes/1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes/(1024*1024):.1f} MB"
        else:
            return f"{size_bytes/(1024*1024*1024):.2f} GB"
    
    def start_upload(self):
        """发出开始上传信号"""
        self.start_upload_signal.emit(self.files)
        self.accept() 