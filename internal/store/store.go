package store

import (
	"baoshiTD/internal/model"
	"sync"
)

// Store V3-1 MVP: 内存单例存储（后端重启清空）。
// 升级 SQLite 时，只需替换 AccountStore / SaveStore 的底层实现即可，API 签名保持不变。
var (
	accountsMu sync.RWMutex
	accounts   = make(map[string]*model.Account) // key=username lowercase
	accountIDs = make(map[uint]*model.Account)
	accountSeq uint = 1

	savesMu sync.RWMutex
	saves   = make(map[uint]*model.GameSaveRecord) // key=account.ID
)

// ==== Accounts ====
func CreateAccount(username, passwordHash string) *model.Account {
	accountsMu.Lock()
	defer accountsMu.Unlock()
	a := &model.Account{
		ID:           accountSeq,
		Username:     username,
		PasswordHash: passwordHash,
	}
	accounts[username] = a
	accountIDs[a.ID] = a
	accountSeq++
	return a
}
func AccountByName(username string) *model.Account {
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	return accounts[username]
}
func AccountByID(id uint) *model.Account {
	accountsMu.RLock()
	defer accountsMu.RUnlock()
	return accountIDs[id]
}

// ==== Saves (uid => one record) ====
func GetSave(uid uint) *model.GameSaveRecord {
	savesMu.RLock()
	defer savesMu.RUnlock()
	rec, ok := saves[uid]
	if !ok {
		return nil
	}
	// 返回副本，避免调用方修改内部状态
	cp := *rec
	return &cp
}
func SetSave(uid uint, rec *model.GameSaveRecord) {
	savesMu.Lock()
	defer savesMu.Unlock()
	saves[uid] = rec
}
