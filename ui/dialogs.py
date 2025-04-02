"""对话框类定义"""

from PyQt6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
                            QProgressBar, QDialogButtonBox, QTableWidget,
                            QTableWidgetItem, QHeaderView, QTabWidget,
                            QWidget, QGroupBox, QFrame, QPushButton)
from PyQt6.QtCore import Qt, pyqtSignal, QSize
from PyQt6.QtGui import QFont, QColor, QIcon, QPixmap

from .styles import STYLE_SHEET

class ScanProgressDialog(QDialog):
    """扫描进度对话框"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('扫描进度')
        self.setGeometry(300, 300, 560, 200)
        self.setModal(True)
        self.setStyleSheet(STYLE_SHEET)
        
        layout = QVBoxLayout()
        layout.setSpacing(16)
        layout.setContentsMargins(24, 24, 24, 24)
        
        # 标题和图标
        title_layout = QHBoxLayout()
        title_layout.setSpacing(16)
        
        # 如果有图标可以添加
        # scan_icon = QLabel()
        # scan_icon.setPixmap(QPixmap("images/scan.png").scaled(36, 36, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        # title_layout.addWidget(scan_icon)
        
        # 标题标签
        self.status_label = QLabel("正在扫描媒体文件...")
        self.status_label.setStyleSheet("""
            font-size: 18px;
            font-weight: 600;
            color: #3949AB;
        """)
        title_layout.addWidget(self.status_label)
        title_layout.addStretch(1)
        
        layout.addLayout(title_layout)
        
        # 当前文件信息卡片
        file_card = QFrame()
        file_card.setFrameStyle(QFrame.Shape.StyledPanel)
        file_card.setStyleSheet("""
            background-color: #F8F9FA;
            border-radius: 8px;
            border: 1px solid #E9ECEF;
        """)
        
        file_layout = QVBoxLayout(file_card)
        file_layout.setSpacing(8)
        file_layout.setContentsMargins(16, 16, 16, 16)
        
        # 文件标签
        file_header = QLabel("当前处理文件")
        file_header.setStyleSheet("color: #6C757D; font-size: 12px;")
        
        self.file_label = QLabel("")
        self.file_label.setWordWrap(True)
        self.file_label.setStyleSheet("color: #212529; font-size: 13px; font-weight: 500;")
        self.file_label.setMinimumHeight(40)
        
        file_layout.addWidget(file_header)
        file_layout.addWidget(self.file_label)
        
        layout.addWidget(file_card)
        
        # 进度条
        progress_layout = QVBoxLayout()
        progress_layout.setSpacing(8)
        
        progress_header = QLabel("扫描进度")
        progress_header.setStyleSheet("color: #6C757D; font-size: 12px;")
        progress_layout.addWidget(progress_header)
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setMinimumHeight(16)
        progress_layout.addWidget(self.progress_bar)
        
        layout.addLayout(progress_layout)
        
        # 取消按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch(1)
        
        cancel_btn = QPushButton('取消扫描')
        cancel_btn.setObjectName("cancelButton")
        # 如果有图标可以添加
        # cancel_btn.setIcon(QIcon("images/cancel.png"))
        # cancel_btn.setIconSize(QSize(16, 16))
        cancel_btn.setFixedSize(120, 40)
        cancel_btn.clicked.connect(self.reject)
        
        button_layout.addWidget(cancel_btn)
        
        layout.addLayout(button_layout)
        
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
        self.setGeometry(100, 100, 960, 680)
        
        layout = QVBoxLayout()
        layout.setSpacing(16)
        layout.setContentsMargins(24, 24, 24, 24)
        
        # 添加统计信息
        stats_box = QGroupBox("扫描统计")
        stats_box.setStyleSheet("""
            QGroupBox {
                font-size: 15px;
            }
        """)
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(16)
        stats_layout.setContentsMargins(16, 0, 16, 16)
        
        # 创建现代化统计卡片
        stats_cards = [
            ("总文件数", self.stats['total'], "#3949AB", "#E8EAF6", "images/file.png"),
            ("将上传", self.stats['upload'], "#00897B", "#E0F2F1", "images/upload.png"),
            ("将覆盖", self.stats['overwrite'], "#F57C00", "#FFF3E0", "images/refresh.png"),
            ("将跳过", self.stats['skip'], "#757575", "#EEEEEE", "images/skip.png")
        ]
        
        for title, value, color, bg_color, icon_path in stats_cards:
            card = QFrame()
            card.setFrameStyle(QFrame.Shape.StyledPanel)
            card.setStyleSheet(f"""
                QFrame {{
                    background-color: {bg_color};
                    border-radius: 12px;
                    border: 1px solid {color}20;
                }}
            """)
            
            card_layout = QHBoxLayout()
            card_layout.setSpacing(12)
            card_layout.setContentsMargins(16, 16, 16, 16)
            
            # 图标区域
            icon_container = QFrame()
            icon_container.setFixedSize(48, 48)
            icon_container.setStyleSheet(f"""
                background-color: {color}15;
                border-radius: 24px;
            """)
            
            # 如果有图标的话可以加载
            # icon_label = QLabel()
            # icon_pixmap = QPixmap(icon_path)
            # icon_label.setPixmap(icon_pixmap.scaled(24, 24, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
            # icon_layout = QVBoxLayout(icon_container)
            # icon_layout.addWidget(icon_label, alignment=Qt.AlignmentFlag.AlignCenter)
            
            # 信息区域
            info_layout = QVBoxLayout()
            info_layout.setSpacing(4)
            
            value_label = QLabel(str(value))
            value_label.setStyleSheet(f"""
                color: {color};
                font-size: 24px;
                font-weight: bold;
                border: none;
            """)
            
            title_label = QLabel(title)
            title_label.setStyleSheet(f"""
                color: {color};
                font-size: 14px;
                border: none;
            """)
            
            info_layout.addWidget(value_label)
            info_layout.addWidget(title_label)
            
            card_layout.addWidget(icon_container)
            card_layout.addLayout(info_layout, 1)
            card.setLayout(card_layout)
            
            stats_layout.addWidget(card, 1)
        
        stats_box.setLayout(stats_layout)
        layout.addWidget(stats_box)
        
        # 创建标签页用于显示不同状态的文件
        tab_widget = QTabWidget()
        
        # 所有文件
        all_files_tab = QWidget()
        all_files_layout = QVBoxLayout()
        all_files_layout.setContentsMargins(0, 0, 0, 0)
        all_files_table = self.create_file_table(self.files)
        all_files_layout.addWidget(all_files_table)
        all_files_tab.setLayout(all_files_layout)
        tab_widget.addTab(all_files_tab, f"所有文件 ({self.stats['total']})")
        
        # 将上传
        upload_files = [f for f in self.files if f.status == "将上传"]
        upload_tab = QWidget()
        upload_layout = QVBoxLayout()
        upload_layout.setContentsMargins(0, 0, 0, 0)
        upload_table = self.create_file_table(upload_files)
        upload_layout.addWidget(upload_table)
        upload_tab.setLayout(upload_layout)
        tab_widget.addTab(upload_tab, f"将上传 ({self.stats['upload']})")
        
        # 将覆盖
        overwrite_files = [f for f in self.files if f.status == "将覆盖"]
        overwrite_tab = QWidget()
        overwrite_layout = QVBoxLayout()
        overwrite_layout.setContentsMargins(0, 0, 0, 0)
        overwrite_table = self.create_file_table(overwrite_files)
        overwrite_layout.addWidget(overwrite_table)
        overwrite_tab.setLayout(overwrite_layout)
        tab_widget.addTab(overwrite_tab, f"将覆盖 ({self.stats['overwrite']})")
        
        # 将跳过
        skip_files = [f for f in self.files if f.status == "将跳过"]
        skip_tab = QWidget()
        skip_layout = QVBoxLayout()
        skip_layout.setContentsMargins(0, 0, 0, 0)
        skip_table = self.create_file_table(skip_files)
        skip_layout.addWidget(skip_table)
        skip_tab.setLayout(skip_layout)
        tab_widget.addTab(skip_tab, f"将跳过 ({self.stats['skip']})")
        
        layout.addWidget(tab_widget)
        
        # 底部按钮
        buttons_layout = QHBoxLayout()
        buttons_layout.setSpacing(16)
        
        self.start_btn = QPushButton('开始上传')
        self.start_btn.setObjectName("startButton")
        self.start_btn.setIcon(QIcon("images/upload_white.png"))  # 如果有图标的话
        self.start_btn.setIconSize(QSize(20, 20))  # 设置图标大小
        self.start_btn.clicked.connect(self.start_upload)
        self.start_btn.setFlat(False)  # 确保不是平面按钮
        self.start_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)  # 防止焦点边框
        
        self.cancel_btn = QPushButton('取消')
        self.cancel_btn.setObjectName("cancelButton")
        self.cancel_btn.setIcon(QIcon("images/cancel.png"))  # 如果有图标的话
        self.cancel_btn.setIconSize(QSize(20, 20))  # 设置图标大小
        self.cancel_btn.clicked.connect(self.reject)
        self.cancel_btn.setFlat(False)  # 确保不是平面按钮
        self.cancel_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)  # 防止焦点边框
        
        # 设置按钮大小
        self.start_btn.setFixedSize(160, 48)
        self.cancel_btn.setFixedSize(120, 48)
        
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
        
        # 设置表格交替行颜色
        table.setAlternatingRowColors(True)
        
        # 调整表格外观
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for i in range(1, 4):  # 前4列自适应内容
            table.horizontalHeader().setSectionResizeMode(i, QHeaderView.ResizeMode.ResizeToContents)
        
        # 设置状态列的固定宽度
        table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        table.setColumnWidth(4, 90)  # 设置第5列宽度为120像素
        
        # 设置行高
        table.verticalHeader().setDefaultSectionSize(42)  # 设置默认行高为46像素
        
        # 隐藏垂直表头
        table.verticalHeader().setVisible(False)
        
        # 添加表格整体样式，包括默认文字颜色
        table.setStyleSheet("""
            QTableWidget {
                color: #212529;
                gridline-color: #E9ECEF;
            }
            QTableWidget::item {
                color: #212529;
                border-bottom: 1px solid #E9ECEF;
            }
        """)
        
        for i, file in enumerate(files):
            # 文件名
            name_item = QTableWidgetItem(file.filename)
            name_item.setForeground(QColor("#212529"))  # 深灰色，接近黑色
            table.setItem(i, 0, name_item)
            
            # 类型
            type_item = QTableWidgetItem(file.file_type)
            type_item.setForeground(QColor("#212529"))
            table.setItem(i, 1, type_item)
            
            # 大小 (转换为更友好的格式)
            size_str = self.format_size(file.file_size)
            size_item = QTableWidgetItem(size_str)
            size_item.setForeground(QColor("#212529"))
            table.setItem(i, 2, size_item)
            
            # 日期
            date_str = file.date.strftime('%Y-%m-%d %H:%M:%S')
            date_item = QTableWidgetItem(date_str)
            date_item.setForeground(QColor("#212529"))
            table.setItem(i, 3, date_item)
            
            # 状态 - 创建自定义的标签来显示状态
            status_cell = QWidget()
            status_layout = QHBoxLayout(status_cell)
            status_layout.setContentsMargins(0, 0, 0, 0)
            status_layout.setSpacing(0)
            
            if file.status == "将上传":
                # 现代风格的状态标签
                status_label = QLabel("将上传")
                status_label.setStyleSheet("""
                    color: #00695C;
                    background-color: #E0F2F1;
                    border-radius: 6px;
                    border: 1px solid #B2DFDB;
                    padding: 2px 6px;
                    font-weight: 500;
                    font-size: 12px;
                    min-width: 48px;
                    min-height: 16px;
                """)
            elif file.status == "将覆盖":
                status_label = QLabel("将覆盖")
                status_label.setStyleSheet("""
                    color: #E65100;
                    background-color: #FFF3E0;
                    border-radius: 6px;
                    border: 1px solid #FFE0B2;
                    padding: 2px 6px;
                    font-weight: 500;
                    font-size: 12px;
                    min-width: 48px;
                    min-height: 16px;
                """)
            elif file.status == "将跳过":
                status_label = QLabel("将跳过")
                status_label.setStyleSheet("""
                    color: #546E7A;
                    background-color: #ECEFF1;
                    border-radius: 6px;
                    border: 1px solid #CFD8DC;
                    padding: 2px 6px;
                    font-weight: 500;
                    font-size: 12px;
                    min-width: 48px;
                    min-height: 16px;
                """)
            else:
                status_label = QLabel(file.status)
                status_label.setStyleSheet("""
                    color: #424242;
                    background-color: #F5F5F5;
                    border-radius: 6px;
                    border: 1px solid #E0E0E0;
                    padding: 2px 6px;
                    font-weight: 500;
                    font-size: 12px;
                    min-width: 48px;
                    min-height: 16px;
                """)
            
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