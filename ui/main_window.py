"""主窗口类定义"""

import os
from PyQt6.QtWidgets import (QMainWindow, QPushButton, QLabel, QFileDialog, 
                            QVBoxLayout, QHBoxLayout, QWidget, QProgressBar, 
                            QMessageBox, QCheckBox, QTextEdit, QGroupBox,
                            QApplication)
from PyQt6.QtCore import Qt

from media_scanner import MediaScanner, ScannerThread
from uploader import MediaUploader
from config import AppConfig
from .styles import STYLE_SHEET
from .dialogs import ScanProgressDialog, ScanResultDialog


class MainWindow(QMainWindow):
    """主窗口"""
    def __init__(self):
        super().__init__()
        
        # 加载配置
        self.config = AppConfig.load_config()
        
        # 初始化扫描器
        self.scanner = MediaScanner()
        
        # 设置窗口样式
        self.setStyleSheet(STYLE_SHEET)
        
        # 设置全局焦点策略
        QApplication.setStyle("fusion")  # 使用Fusion样式，更一致的外观
        
        # 初始化UI
        self.initUI()
        
        # 上传状态
        self.uploader = None
        self.media_files = []
        self.scanner_thread = None
    
    def initUI(self):
        self.setWindowTitle('照片/视频 NAS上传工具')
        self.setGeometry(100, 100, 800, 600)
        
        # 主布局
        main_layout = QVBoxLayout()
        main_layout.setSpacing(12)
        main_layout.setContentsMargins(20, 20, 20, 20)
        
        # 源目录选择
        source_group = QGroupBox("源目录")
        source_layout = QHBoxLayout()
        source_layout.setSpacing(16)
        source_layout.setContentsMargins(16, 0, 16, 16)
        
        self.source_path = QLabel(self.config.source_dir or '未选择')
        self.source_path.setStyleSheet("""
            QLabel {
                padding: 4px 12px;
                background-color: #FFFFFF;
                border: 2px solid #E0E0E0;
                border-radius: 8px;
            }
        """)
        self.source_btn = QPushButton('选择文件夹')
        self.source_btn.clicked.connect(self.select_source_dir)
        
        source_layout.addWidget(self.source_path, 1)
        source_layout.addWidget(self.source_btn)
        source_group.setLayout(source_layout)
        
        # 目标目录选择
        target_group = QGroupBox("目标目录")
        target_layout = QHBoxLayout()
        target_layout.setSpacing(16)
        target_layout.setContentsMargins(16, 0, 16, 16)
        
        self.target_path = QLabel(self.config.target_dir or '未选择')
        self.target_path.setStyleSheet("""
            QLabel {
                padding: 4px 12px;
                background-color: #FFFFFF;
                border: 2px solid #E0E0E0;
                border-radius: 8px;
            }
        """)
        self.target_btn = QPushButton('选择文件夹')
        self.target_btn.clicked.connect(self.select_target_dir)
        
        target_layout.addWidget(self.target_path, 1)
        target_layout.addWidget(self.target_btn)
        target_group.setLayout(target_layout)
        
        # 选项
        options_group = QGroupBox("选项")
        options_layout = QVBoxLayout()
        options_layout.setSpacing(10)
        options_layout.setContentsMargins(16, 0, 16, 16)
        
        # 覆盖选项
        overwrite_layout = QHBoxLayout()
        self.overwrite_check = QCheckBox('覆盖重复文件')
        self.overwrite_check.setChecked(self.config.overwrite_duplicates)
        overwrite_description = QLabel("（当目标位置存在同名但大小不同的文件时覆盖，大小相同的文件将始终被视为相同文件而跳过）")
        overwrite_description.setStyleSheet("color: #666666; font-size: 12px;")
        overwrite_layout.addWidget(self.overwrite_check)
        overwrite_layout.addWidget(overwrite_description)
        overwrite_layout.addStretch(1)
        
        # 添加文件夹说明
        folder_info = QLabel("文件将按照拍摄日期（格式：YYYY-MM-DD）自动归类到相应的子文件夹中")
        folder_info.setStyleSheet("color: #666666; font-size: 12px; padding: 5px 0;")
        
        # 添加到主布局
        options_layout.addLayout(overwrite_layout)
        options_layout.addWidget(folder_info)
        options_group.setLayout(options_layout)
        
        # 动作按钮布局
        action_layout = QHBoxLayout()
        action_layout.setSpacing(8)
        
        # 预扫描按钮
        self.scan_btn = QPushButton('预扫描')
        self.scan_btn.clicked.connect(self.pre_scan)
        self.scan_btn.setEnabled(False)
        
        # 开始按钮
        self.start_btn = QPushButton('开始上传')
        self.start_btn.clicked.connect(self.start_upload)
        self.start_btn.setEnabled(False)
        
        # 暂停按钮
        self.pause_btn = QPushButton('暂停')
        self.pause_btn.setObjectName("pauseButton")
        self.pause_btn.clicked.connect(self.toggle_pause)
        self.pause_btn.setEnabled(False)
        
        # 取消按钮
        self.cancel_btn = QPushButton('取消')
        self.cancel_btn.setObjectName("cancelButton")
        self.cancel_btn.clicked.connect(self.cancel_upload)
        self.cancel_btn.setEnabled(False)
        
        action_layout.addWidget(self.scan_btn)
        action_layout.addWidget(self.start_btn)
        action_layout.addWidget(self.pause_btn)
        action_layout.addWidget(self.cancel_btn)
        
        # 进度条
        self.progress_bar = QProgressBar()
        self.progress_bar.setMinimumHeight(20)
        self.progress_bar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        # 添加所有布局
        main_layout.addWidget(source_group)
        main_layout.addWidget(target_group)
        main_layout.addWidget(options_group)
        main_layout.addLayout(action_layout)
        main_layout.addWidget(self.progress_bar)
        
        # 日志区域 - 移除QGroupBox嵌套
        log_label = QLabel("日志")
        log_label.setStyleSheet("font-weight: bold; font-size: 14px;")
        main_layout.addWidget(log_label)
        
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        self.log_area.setMinimumHeight(200)
        main_layout.addWidget(self.log_area)
        
        # 设置主窗口
        container = QWidget()
        container.setLayout(main_layout)
        self.setCentralWidget(container)
        
        # 初始状态检查
        self.check_buttons_state()
    
    def select_source_dir(self):
        """选择源目录"""
        # 获取上次选择的目录，如果不存在则使用用户主目录
        last_dir = self.config.source_dir if self.config.source_dir and os.path.exists(self.config.source_dir) else os.path.expanduser('~')
        dir_path = QFileDialog.getExistingDirectory(self, '选择源目录', last_dir)
        if dir_path:
            self.source_path.setText(dir_path)
            self.config.source_dir = dir_path
            self.config.save_config()
            self.check_buttons_state()
    
    def select_target_dir(self):
        """选择目标目录"""
        # 获取上次选择的目录，如果不存在则使用用户主目录
        last_dir = self.config.target_dir if self.config.target_dir and os.path.exists(self.config.target_dir) else os.path.expanduser('~')
        dir_path = QFileDialog.getExistingDirectory(self, '选择NAS目录', last_dir)
        if dir_path:
            self.target_path.setText(dir_path)
            self.config.target_dir = dir_path
            self.config.save_config()
            self.check_buttons_state()
    
    def check_buttons_state(self):
        """检查按钮状态，根据条件启用或禁用"""
        source_valid = self.source_path.text() != '未选择' and os.path.exists(self.source_path.text())
        target_valid = self.target_path.text() != '未选择' and os.path.exists(self.target_path.text())
        
        # 预扫描和开始按钮
        self.scan_btn.setEnabled(source_valid and target_valid)
        self.start_btn.setEnabled(source_valid and target_valid)
        
        # 更新配置
        self.config.overwrite_duplicates = self.overwrite_check.isChecked()
        self.config.save_config()
    
    def pre_scan(self):
        """预扫描功能"""
        source_dir = self.source_path.text()
        target_dir = self.target_path.text()
        overwrite = self.overwrite_check.isChecked()
        
        if not os.path.exists(source_dir):
            QMessageBox.warning(self, '错误', '源目录不存在!')
            return
        
        if not os.path.exists(target_dir):
            QMessageBox.warning(self, '错误', 'NAS目录不存在!')
            return
        
        # 禁用按钮
        self.scan_btn.setEnabled(False)
        self.start_btn.setEnabled(False)
        
        # 显示扫描进度对话框
        progress_dialog = ScanProgressDialog(self)
        
        # 创建扫描线程
        self.scanner_thread = ScannerThread(source_dir, target_dir, overwrite)
        self.scanner_thread.progress_signal.connect(progress_dialog.update_progress)
        self.scanner_thread.finished_signal.connect(self.on_scan_finished)
        
        # 如果对话框被取消，终止扫描线程
        progress_dialog.rejected.connect(self.cancel_scan)
        
        # 开始扫描
        self.scanner_thread.start()
        
        # 显示进度对话框（会阻塞，但界面会保持响应性）
        progress_dialog.exec()
    
    def cancel_scan(self):
        """取消扫描过程"""
        if self.scanner_thread and self.scanner_thread.isRunning():
            self.scanner_thread.terminate()
            self.scanner_thread.wait()
            self.add_log('扫描已取消')
            
        # 恢复按钮状态
        self.scan_btn.setEnabled(True)
        self.start_btn.setEnabled(True)
    
    def on_scan_finished(self, scan_results):
        """扫描完成的处理函数"""
        try:
            # 关闭可能存在的进度对话框
            for widget in QApplication.topLevelWidgets():
                if isinstance(widget, ScanProgressDialog):
                    widget.accept()
            
            if not scan_results["files"]:
                QMessageBox.information(self, '信息', '没有找到支持的媒体文件!')
                self.scan_btn.setEnabled(True)
                self.start_btn.setEnabled(True)
                return
            
            # 显示预扫描结果对话框
            dialog = ScanResultDialog(scan_results, self)
            dialog.start_upload_signal.connect(self.start_upload_with_files)
            
            # 恢复按钮状态
            self.scan_btn.setEnabled(True)
            self.start_btn.setEnabled(True)
            
            # 显示对话框
            dialog.exec()
        except Exception as e:
            QMessageBox.critical(self, '错误', f'处理扫描结果时发生错误：{str(e)}')
            self.scan_btn.setEnabled(True)
            self.start_btn.setEnabled(True)
    
    def start_upload_with_files(self, files):
        """使用预扫描的文件开始上传"""
        self.media_files = files
        self.start_upload()
    
    def start_upload(self):
        """开始上传"""
        # 如果没有预扫描，先扫描文件
        if not self.media_files:
            source_dir = self.source_path.text()
            target_dir = self.target_path.text()
            overwrite = self.overwrite_check.isChecked()
            
            if not os.path.exists(source_dir):
                QMessageBox.warning(self, '错误', '源目录不存在!')
                return
            
            if not os.path.exists(target_dir):
                QMessageBox.warning(self, '错误', 'NAS目录不存在!')
                return
            
            # 显示扫描状态
            self.add_log('扫描媒体文件...')
            progress_dialog = ScanProgressDialog(self)
            
            # 创建扫描线程
            self.scanner_thread = ScannerThread(source_dir, target_dir, overwrite)
            self.scanner_thread.progress_signal.connect(progress_dialog.update_progress)
            self.scanner_thread.finished_signal.connect(self.on_scan_finished_for_upload)
            
            # 开始扫描
            self.scanner_thread.start()
            
            # 显示进度对话框
            progress_dialog.exec()
            return
        
        # 禁用相关按钮
        self.scan_btn.setEnabled(False)
        self.start_btn.setEnabled(False)
        self.source_btn.setEnabled(False)
        self.target_btn.setEnabled(False)
        
        # 启用暂停和取消按钮
        self.pause_btn.setEnabled(True)
        self.cancel_btn.setEnabled(True)
        
        # 清空日志
        self.log_area.clear()
        self.add_log('开始上传媒体文件...')
        
        # 创建并启动上传线程
        self.uploader = MediaUploader(
            self.media_files, 
            self.target_path.text(), 
            self.overwrite_check.isChecked()
        )
        self.uploader.progress_update.connect(self.update_progress)
        self.uploader.status_update.connect(self.add_log)
        self.uploader.finished.connect(self.upload_finished)
        self.uploader.start()
    
    def on_scan_finished_for_upload(self, scan_results):
        """用于直接上传的扫描完成处理函数"""
        # 关闭可能存在的进度对话框
        for widget in QApplication.topLevelWidgets():
            if isinstance(widget, ScanProgressDialog):
                widget.accept()
        
        if not scan_results["files"]:
            QMessageBox.information(self, '信息', '没有找到支持的媒体文件!')
            return
        
        # 获取文件并开始上传
        self.media_files = scan_results["files"]
        self.start_upload()
    
    def toggle_pause(self):
        """暂停/恢复上传"""
        if self.uploader and self.uploader.isRunning():
            if self.uploader.is_paused():
                # 当前是暂停状态，恢复上传
                self.uploader.resume()
                self.pause_btn.setText('暂停')
            else:
                # 当前是运行状态，暂停上传
                self.uploader.pause()
                self.pause_btn.setText('继续')
    
    def cancel_upload(self):
        """取消上传"""
        if self.uploader and self.uploader.isRunning():
            reply = QMessageBox.question(
                self, '确认', '确定要取消上传吗？',
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, 
                QMessageBox.StandardButton.No
            )
            
            if reply == QMessageBox.StandardButton.Yes:
                self.uploader.cancel()
                self.add_log("正在取消上传...")
    
    def update_progress(self, current, total):
        """更新进度条"""
        percentage = int((current / total) * 100) if total > 0 else 0
        self.progress_bar.setValue(percentage)
    
    def add_log(self, message):
        """添加日志"""
        self.log_area.append(message)
        # 滚动到底部
        self.log_area.verticalScrollBar().setValue(
            self.log_area.verticalScrollBar().maximum()
        )
    
    def upload_finished(self):
        """上传完成"""
        self.add_log('上传处理完成!')
        
        # 恢复按钮状态
        self.scan_btn.setEnabled(True)
        self.start_btn.setEnabled(True)
        self.source_btn.setEnabled(True)
        self.target_btn.setEnabled(True)
        self.pause_btn.setEnabled(False)
        self.cancel_btn.setEnabled(False)
        
        # 重置暂停按钮文本
        self.pause_btn.setText('暂停')
        
        # 清空文件列表，以便下次重新扫描
        self.media_files = []
        
        QMessageBox.information(self, '完成', '媒体文件处理已完成!')
    
    def closeEvent(self, event):
        """关闭窗口事件"""
        # 保存配置
        self.config.save_config()
        
        # 如果上传任务正在运行，询问用户
        if self.uploader and self.uploader.isRunning():
            reply = QMessageBox.question(
                self, '确认', '上传任务正在进行中，确定要退出吗？',
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, 
                QMessageBox.StandardButton.No
            )
            
            if reply == QMessageBox.StandardButton.Yes:
                self.uploader.cancel()
                event.accept()
            else:
                event.ignore()
        else:
            event.accept() 