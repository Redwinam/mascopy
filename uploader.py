#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import shutil
from PyQt6.QtCore import QThread, pyqtSignal

class MediaUploader(QThread):
    """媒体文件上传器，支持暂停和恢复功能"""
    progress_update = pyqtSignal(int, int)  # 当前进度, 总数
    status_update = pyqtSignal(str)  # 状态更新
    file_processed = pyqtSignal(str, bool)  # 文件路径, 是否成功
    finished = pyqtSignal()  # 完成信号

    def __init__(self, media_files, target_dir, overwrite_duplicates):
        super().__init__()
        self.media_files = media_files
        self.target_dir = target_dir
        self.overwrite_duplicates = overwrite_duplicates
        self.paused = False
        self.cancelled = False
        self.current_index = 0
    
    def run(self):
        """上传线程主函数"""
        total_files = len(self.media_files)
        processed_files = 0
        
        self.current_index = 0
        self.status_update.emit(f"开始上传 {total_files} 个媒体文件...")
        
        while self.current_index < total_files and not self.cancelled:
            # 检查是否暂停
            if self.paused:
                self.sleep(1)  # 暂停时每秒检查一次
                continue
            
            media_file = self.media_files[self.current_index]
            try:
                # 已经在预扫描时设置了目标路径和状态
                target_file_path = media_file.target_path
                date_folder = os.path.dirname(target_file_path).split(os.path.sep)[-1]
                
                if media_file.status == "将上传" or media_file.status == "将覆盖":
                    # 确保目标目录存在
                    os.makedirs(os.path.dirname(target_file_path), exist_ok=True)
                    
                    # 复制文件
                    shutil.copy2(media_file.file_path, target_file_path)
                    self.status_update.emit(f"已复制 ({media_file.file_type}): {media_file.filename} -> {date_folder}/")
                    self.file_processed.emit(media_file.file_path, True)
                else:
                    # 跳过文件
                    self.status_update.emit(f"跳过 ({media_file.file_type}): {media_file.filename}")
                    self.file_processed.emit(media_file.file_path, True)
                
                processed_files += 1
                self.progress_update.emit(processed_files, total_files)
                
            except Exception as e:
                self.status_update.emit(f"处理文件出错 {media_file.filename}: {str(e)}")
                self.file_processed.emit(media_file.file_path, False)
            
            self.current_index += 1
        
        if self.cancelled:
            self.status_update.emit("上传已取消")
        else:
            self.status_update.emit("上传完成!")
        
        self.finished.emit()
    
    def pause(self):
        """暂停上传"""
        if not self.paused:
            self.paused = True
            self.status_update.emit("上传已暂停")
    
    def resume(self):
        """恢复上传"""
        if self.paused:
            self.paused = False
            self.status_update.emit("继续上传...")
    
    def cancel(self):
        """取消上传"""
        self.cancelled = True
        self.status_update.emit("正在取消上传...")
        
    def is_paused(self):
        """返回是否暂停状态"""
        return self.paused 