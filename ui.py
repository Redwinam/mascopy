#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from PyQt6.QtWidgets import (QMainWindow, QPushButton, QLabel, QFileDialog, 
                            QVBoxLayout, QHBoxLayout, QWidget, QProgressBar, 
                            QMessageBox, QCheckBox, QTextEdit, QDialog, 
                            QTableWidget, QTableWidgetItem, QHeaderView, 
                            QTabWidget, QSplitter, QGroupBox, QDialogButtonBox,
                            QApplication)
from PyQt6.QtCore import Qt, pyqtSignal, QSize
from PyQt6.QtGui import QIcon, QPixmap, QFont, QColor

from media_scanner import MediaScanner, ScannerThread
from uploader import MediaUploader
from config import AppConfig


class ScanProgressDialog(QDialog):
    """扫描进度对话框"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('扫描进度')
        self.setGeometry(300, 300, 500, 150)
        self.setModal(True)
        
        layout = QVBoxLayout()
        
        # 进度标签
        self.status_label = QLabel("正在扫描文件...")
        layout.addWidget(self.status_label)
        
        # 当前文件标签
        self.file_label = QLabel("")
        self.file_label.setWordWrap(True)  # 允许文本换行
        layout.addWidget(self.file_label)
        
        # 进度条
        self.progress_bar = QProgressBar()
        layout.addWidget(self.progress_bar)
        
        # 取消按钮
        self.button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel)
        self.button_box.rejected.connect(self.reject)
        layout.addWidget(self.button_box)
        
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
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('预扫描结果')
        self.setGeometry(100, 100, 900, 600)
        
        layout = QVBoxLayout()
        
        # 添加统计信息
        stats_box = QGroupBox("统计信息")
        stats_layout = QHBoxLayout()
        
        total_label = QLabel(f"总文件数: {self.stats['total']}")
        upload_label = QLabel(f"将上传: {self.stats['upload']}")
        overwrite_label = QLabel(f"将覆盖: {self.stats['overwrite']}")
        skip_label = QLabel(f"将跳过: {self.stats['skip']}")
        
        # 设置更大的字体
        font = QFont()
        font.setPointSize(12)
        font.setBold(True)
        total_label.setFont(font)
        upload_label.setFont(font)
        overwrite_label.setFont(font)
        skip_label.setFont(font)
        
        stats_layout.addWidget(total_label)
        stats_layout.addWidget(upload_label)
        stats_layout.addWidget(overwrite_label)
        stats_layout.addWidget(skip_label)
        
        stats_box.setLayout(stats_layout)
        layout.addWidget(stats_box)
        
        # 创建标签页用于显示不同状态的文件
        tab_widget = QTabWidget()
        
        # 所有文件
        all_files_tab = QWidget()
        all_files_layout = QVBoxLayout()
        all_files_table = self.create_file_table(self.files)
        all_files_layout.addWidget(all_files_table)
        all_files_tab.setLayout(all_files_layout)
        tab_widget.addTab(all_files_tab, f"所有文件 ({self.stats['total']})")
        
        # 将上传
        upload_files = [f for f in self.files if f.status == "将上传"]
        upload_tab = QWidget()
        upload_layout = QVBoxLayout()
        upload_table = self.create_file_table(upload_files)
        upload_layout.addWidget(upload_table)
        upload_tab.setLayout(upload_layout)
        tab_widget.addTab(upload_tab, f"将上传 ({self.stats['upload']})")
        
        # 将覆盖
        overwrite_files = [f for f in self.files if f.status == "将覆盖"]
        overwrite_tab = QWidget()
        overwrite_layout = QVBoxLayout()
        overwrite_table = self.create_file_table(overwrite_files)
        overwrite_layout.addWidget(overwrite_table)
        overwrite_tab.setLayout(overwrite_layout)
        tab_widget.addTab(overwrite_tab, f"将覆盖 ({self.stats['overwrite']})")
        
        # 将跳过
        skip_files = [f for f in self.files if f.status == "将跳过"]
        skip_tab = QWidget()
        skip_layout = QVBoxLayout()
        skip_table = self.create_file_table(skip_files)
        skip_layout.addWidget(skip_table)
        skip_tab.setLayout(skip_layout)
        tab_widget.addTab(skip_tab, f"将跳过 ({self.stats['skip']})")
        
        layout.addWidget(tab_widget)
        
        # 底部按钮
        buttons_layout = QHBoxLayout()
        self.start_btn = QPushButton('开始上传')
        self.start_btn.clicked.connect(self.start_upload)
        self.cancel_btn = QPushButton('取消')
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
        for i in range(1, 5):
            table.horizontalHeader().setSectionResizeMode(i, QHeaderView.ResizeMode.ResizeToContents)
        
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
            
            # 状态
            status_item = QTableWidgetItem(file.status)
            
            # 根据状态设置颜色
            if file.status == "将上传":
                status_item.setForeground(QColor(0, 128, 0))  # 绿色
            elif file.status == "将覆盖":
                status_item.setForeground(QColor(255, 165, 0))  # 橙色
            elif file.status == "将跳过":
                status_item.setForeground(QColor(128, 128, 128))  # 灰色
                
            table.setItem(i, 4, status_item)
        
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


class MainWindow(QMainWindow):
    """主窗口"""
    def __init__(self):
        super().__init__()
        
        # 加载配置
        self.config = AppConfig.load_config()
        
        # 初始化扫描器
        self.scanner = MediaScanner()
        
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
        
        # 源目录选择
        source_layout = QHBoxLayout()
        self.source_label = QLabel('源目录:')
        self.source_path = QLabel(self.config.source_dir or '未选择')
        self.source_btn = QPushButton('选择文件夹')
        self.source_btn.clicked.connect(self.select_source_dir)
        
        source_layout.addWidget(self.source_label)
        source_layout.addWidget(self.source_path, 1)
        source_layout.addWidget(self.source_btn)
        
        # 目标目录选择
        target_layout = QHBoxLayout()
        self.target_label = QLabel('NAS目录:')
        self.target_path = QLabel(self.config.target_dir or '未选择')
        self.target_btn = QPushButton('选择文件夹')
        self.target_btn.clicked.connect(self.select_target_dir)
        
        target_layout.addWidget(self.target_label)
        target_layout.addWidget(self.target_path, 1)
        target_layout.addWidget(self.target_btn)
        
        # 选项
        options_layout = QHBoxLayout()
        self.overwrite_check = QCheckBox('覆盖重复文件')
        self.overwrite_check.setChecked(self.config.overwrite_duplicates)
        options_layout.addWidget(self.overwrite_check)
        options_layout.addStretch(1)
        
        # 动作按钮布局
        action_layout = QHBoxLayout()
        
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
        self.pause_btn.clicked.connect(self.toggle_pause)
        self.pause_btn.setEnabled(False)
        
        # 取消按钮
        self.cancel_btn = QPushButton('取消')
        self.cancel_btn.clicked.connect(self.cancel_upload)
        self.cancel_btn.setEnabled(False)
        
        action_layout.addWidget(self.scan_btn)
        action_layout.addWidget(self.start_btn)
        action_layout.addWidget(self.pause_btn)
        action_layout.addWidget(self.cancel_btn)
        
        # 进度条
        self.progress_bar = QProgressBar()
        self.progress_bar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        # 日志区域
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        
        # 添加所有布局
        main_layout.addLayout(source_layout)
        main_layout.addLayout(target_layout)
        main_layout.addLayout(options_layout)
        main_layout.addLayout(action_layout)
        main_layout.addWidget(self.progress_bar)
        main_layout.addWidget(QLabel('日志:'))
        main_layout.addWidget(self.log_area)
        
        # 设置主窗口
        container = QWidget()
        container.setLayout(main_layout)
        self.setCentralWidget(container)
        
        # 初始状态检查
        self.check_buttons_state()
    
    def select_source_dir(self):
        dir_path = QFileDialog.getExistingDirectory(self, '选择源目录')
        if dir_path:
            self.source_path.setText(dir_path)
            self.config.source_dir = dir_path
            self.config.save_config()
            self.check_buttons_state()
    
    def select_target_dir(self):
        dir_path = QFileDialog.getExistingDirectory(self, '选择NAS目录')
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